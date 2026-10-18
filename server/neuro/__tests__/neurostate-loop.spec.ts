import { describe, it, expect } from "vitest";
import type { NeuroFrame } from "../schemas/neuro.schemas.js";
import { NeurostateKernel } from "../kernel/neurostate-loop.js";
import { NeuroFrameRingBuffer } from "../sync/ring-buffer.js";

const mulberry32 = (seed: number): (() => number) => {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const buildSineSeries = (
  frequencyHz: number,
  sampleRateHz: number,
  samples: number,
  phaseOffset = 0,
  amplitude = 1,
  noiseStd = 0,
  rng?: () => number,
): number[] => {
  const out = new Array<number>(samples);
  for (let i = 0; i < samples; i += 1) {
    const t = i / sampleRateHz;
    const base =
      amplitude * Math.sin(2 * Math.PI * frequencyHz * t + phaseOffset);
    const noise =
      noiseStd > 0 && rng ? noiseStd * (rng() * 2 - 1) : 0;
    out[i] = base + noise;
  }
  return out;
};

const pushFrames = (input: {
  buffer: NeuroFrameRingBuffer;
  series: number[][];
  sampleRateHz: number;
  frameSize: number;
  deviceId: string;
  stream: NeuroFrame["stream"];
}) => {
  const { buffer, series, sampleRateHz, frameSize, deviceId, stream } = input;
  const channelCount = series.length;
  const totalSamples = series[0]?.length ?? 0;
  const frameDurationMs = (frameSize / sampleRateHz) * 1000;
  let frameIndex = 0;
  for (let start = 0; start < totalSamples; start += frameSize) {
    const samples = series.map((ch) => ch.slice(start, start + frameSize));
    const frame: NeuroFrame = {
      stream,
      deviceId,
      tsRecvMono: frameIndex * frameDurationMs,
      samples,
      sampleRateHz,
      channelNames: Array.from(
        { length: channelCount },
        (_, idx) => `ch-${idx + 1}`,
      ),
      units: "uV",
    };
    buffer.push(frame);
    frameIndex += 1;
  }
  return frameIndex * frameDurationMs;
};

describe("neurostate EMG gating", () => {
  it("reports low phase dispersion for phase-locked gamma", () => {
    const sampleRateHz = 500;
    const durationSec = 1;
    const samples = sampleRateHz * durationSec;
    const rng = mulberry32(707);
    const eegA = buildSineSeries(
      40,
      sampleRateHz,
      samples,
      0,
      1,
      0.01,
      rng,
    );
    const eegB = buildSineSeries(
      40,
      sampleRateHz,
      samples,
      0.2,
      1,
      0.01,
      rng,
    );

    const buffer = new NeuroFrameRingBuffer({ maxSeconds: 5 });
    const tsEeg = pushFrames({
      buffer,
      series: [eegA, eegB],
      sampleRateHz,
      frameSize: 25,
      deviceId: "sim-disp",
      stream: "eeg",
    });

    const kernel = new NeurostateKernel(buffer, {
      windowSeconds: durationSec,
      lockStreakRequired: 1,
      minSamples: 20,
      minSignalRms: 0,
      maxArtifactRatio: 1,
      artifactAbsMax: 10,
      gammaSurrogateCount: 0,
      gammaMinSamples: 32,
      gammaAnchorHz: 40,
      gammaAnchorBandwidthHz: 8,
      gammaArtifactRequireEmg: false,
    });

    const result = kernel.tick({
      stream: "eeg",
      deviceId: "sim-disp",
      now: tsEeg,
    });

    expect(result.state.phase_dispersion).toBeTypeOf("number");
    expect(result.state.phase_dispersion ?? 1).toBeLessThan(0.3);
  });

  it("fails gamma artifact gate when EMG bursts dominate", () => {
    const sampleRateHz = 500;
    const durationSec = 1;
    const samples = sampleRateHz * durationSec;
    const rng = mulberry32(4242);
    const eegA = buildSineSeries(
      40,
      sampleRateHz,
      samples,
      0,
      1,
      0.01,
      rng,
    );
    const eegB = buildSineSeries(
      40,
      sampleRateHz,
      samples,
      0.4,
      1,
      0.01,
      rng,
    );
    const emgA = buildSineSeries(
      120,
      sampleRateHz,
      samples,
      0,
      2,
      0.02,
      rng,
    );
    const emgB = buildSineSeries(
      120,
      sampleRateHz,
      samples,
      0.6,
      2,
      0.02,
      rng,
    );

    const buffer = new NeuroFrameRingBuffer({ maxSeconds: 5 });
    const tsEeg = pushFrames({
      buffer,
      series: [eegA, eegB],
      sampleRateHz,
      frameSize: 25,
      deviceId: "sim-emg",
      stream: "eeg",
    });
    const tsEmg = pushFrames({
      buffer,
      series: [emgA, emgB],
      sampleRateHz,
      frameSize: 25,
      deviceId: "sim-emg",
      stream: "emg",
    });

    const kernel = new NeurostateKernel(buffer, {
      windowSeconds: durationSec,
      lockStreakRequired: 1,
      minSamples: 20,
      minSignalRms: 0.01,
      maxArtifactRatio: 1,
      artifactAbsMax: 10,
      gammaSurrogateCount: 0,
      gammaMinSamples: 32,
      gammaArtifactRequireEmg: true,
      gammaArtifactEmgPlvMax: 0.9,
      gammaArtifactEmgBurstRatioMax: 0.4,
      gammaArtifactEmgBurstBandHz: { lowHz: 80, highHz: 150 },
    });
    const result = kernel.tick({
      stream: "eeg",
      deviceId: "sim-emg",
      now: Math.max(tsEeg, tsEmg),
    });

    expect(result.state.gamma_artifact_pass).toBe(0);
    expect(result.state.locked).toBe(false);
    expect(result.gate.status).toBe("fail");
  });
});
