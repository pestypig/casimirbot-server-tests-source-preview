import { describe, it, expect } from "vitest";
import { NeuroFrameRingBuffer } from "../sync/ring-buffer.js";
import type { NeuroFrame } from "../schemas/neuro.schemas.js";
import {
  computeGammaPlvFromWindow,
  computeGammaPlvFromWindowWithSurrogates,
} from "../features/gamma-plv.js";

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
  noiseStd = 0,
  rng?: () => number,
): number[] => {
  const out = new Array<number>(samples);
  for (let i = 0; i < samples; i += 1) {
    const t = i / sampleRateHz;
    const base = Math.sin(2 * Math.PI * frequencyHz * t + phaseOffset);
    const noise =
      noiseStd > 0 && rng ? noiseStd * (rng() * 2 - 1) : 0;
    out[i] = base + noise;
  }
  return out;
};

const buildNoiseSeries = (
  samples: number,
  noiseStd: number,
  rng: () => number,
): number[] => {
  const out = new Array<number>(samples);
  for (let i = 0; i < samples; i += 1) {
    out[i] = noiseStd * (rng() * 2 - 1);
  }
  return out;
};

const pushFrames = (input: {
  buffer: NeuroFrameRingBuffer;
  series: number[][];
  sampleRateHz: number;
  frameSize: number;
  deviceId: string;
  stream?: NeuroFrame["stream"];
}) => {
  const {
    buffer,
    series,
    sampleRateHz,
    frameSize,
    deviceId,
    stream = "eeg",
  } = input;
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
  const tsEnd = frameIndex * frameDurationMs;
  return tsEnd;
};

describe("gamma PLV extractor", () => {
  it("returns high PLV for phase-locked gamma signals", () => {
    const sampleRateHz = 500;
    const durationSec = 2;
    const samples = sampleRateHz * durationSec;
    const rng = mulberry32(1337);
    const ch1 = buildSineSeries(40, sampleRateHz, samples, 0, 0.02, rng);
    const ch2 = buildSineSeries(40, sampleRateHz, samples, 0, 0.02, rng);
    const buffer = new NeuroFrameRingBuffer({ maxSeconds: 5 });
    const tsEnd = pushFrames({
      buffer,
      series: [ch1, ch2],
      sampleRateHz,
      frameSize: 25,
      deviceId: "sim-plv",
    });
    const window = buffer.getLatestWindow({
      stream: "eeg",
      deviceId: "sim-plv",
      windowSeconds: durationSec,
      now: tsEnd,
    });
    const result = computeGammaPlvFromWindow(window, { anchorHz: 40 });
    expect(result).not.toBeNull();
    expect(result?.plv ?? 0).toBeGreaterThan(0.9);
  });

  it("returns low PLV for uncorrelated gamma activity", () => {
    const sampleRateHz = 500;
    const durationSec = 2;
    const samples = sampleRateHz * durationSec;
    const rngA = mulberry32(101);
    const rngB = mulberry32(202);
    const ch1 = buildNoiseSeries(samples, 1, rngA);
    const ch2 = buildNoiseSeries(samples, 1, rngB);
    const buffer = new NeuroFrameRingBuffer({ maxSeconds: 5 });
    const tsEnd = pushFrames({
      buffer,
      series: [ch1, ch2],
      sampleRateHz,
      frameSize: 25,
      deviceId: "sim-noise",
    });
    const window = buffer.getLatestWindow({
      stream: "eeg",
      deviceId: "sim-noise",
      windowSeconds: durationSec,
      now: tsEnd,
    });
    const result = computeGammaPlvFromWindow(window);
    expect(result).not.toBeNull();
    expect(result?.plv ?? 1).toBeLessThan(0.4);
  });

  it("returns higher z-scores for phase-locked signals than noise", () => {
    const sampleRateHz = 500;
    const durationSec = 2;
    const samples = sampleRateHz * durationSec;
    const rng = mulberry32(77);
    const lockedA = buildSineSeries(40, sampleRateHz, samples, 0, 0.03, rng);
    const lockedB = buildSineSeries(40, sampleRateHz, samples, 0, 0.03, rng);
    const noiseA = buildNoiseSeries(samples, 1, mulberry32(88));
    const noiseB = buildNoiseSeries(samples, 1, mulberry32(99));
    const buffer = new NeuroFrameRingBuffer({ maxSeconds: 5 });
    const tsLocked = pushFrames({
      buffer,
      series: [lockedA, lockedB],
      sampleRateHz,
      frameSize: 25,
      deviceId: "sim-z-locked",
    });
    const lockedWindow = buffer.getLatestWindow({
      stream: "eeg",
      deviceId: "sim-z-locked",
      windowSeconds: durationSec,
      now: tsLocked,
    });
    const lockedStats = computeGammaPlvFromWindowWithSurrogates(lockedWindow, {
      anchorHz: 40,
      surrogateCount: 30,
      surrogateSeed: 123,
    });
    expect(lockedStats).not.toBeNull();

    const tsNoise = pushFrames({
      buffer,
      series: [noiseA, noiseB],
      sampleRateHz,
      frameSize: 25,
      deviceId: "sim-z-noise",
    });
    const noiseWindow = buffer.getLatestWindow({
      stream: "eeg",
      deviceId: "sim-z-noise",
      windowSeconds: durationSec,
      now: tsNoise,
    });
    const noiseStats = computeGammaPlvFromWindowWithSurrogates(noiseWindow, {
      anchorHz: 40,
      surrogateCount: 30,
      surrogateSeed: 123,
    });
    expect(noiseStats).not.toBeNull();

    const lockedZ = lockedStats?.zScore ?? 0;
    const noiseZ = noiseStats?.zScore ?? 0;
    expect(lockedZ).toBeGreaterThan(2);
    expect(noiseZ).toBeLessThan(1);
  });
});
