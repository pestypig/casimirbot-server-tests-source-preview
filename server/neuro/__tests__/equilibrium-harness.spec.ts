import { describe, it, expect } from "vitest";
import type { NeuroFrame } from "../schemas/neuro.schemas.js";
import { NeuroSimulatorDriver } from "../drivers/driver.simulator.js";
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

const withSeededRandom = (seed: number, fn: () => void) => {
  const original = Math.random;
  Math.random = mulberry32(seed);
  try {
    fn();
  } finally {
    Math.random = original;
  }
};

type GateMetrics = {
  total: number;
  good: number;
  premature: number;
  reversals: number;
  lastDecisionStable: boolean | null;
};

const createMetrics = (): GateMetrics => ({
  total: 0,
  good: 0,
  premature: 0,
  reversals: 0,
  lastDecisionStable: null,
});

const noteCommit = (metrics: GateMetrics, truthStable: boolean) => {
  metrics.total += 1;
  if (truthStable) {
    metrics.good += 1;
  } else {
    metrics.premature += 1;
  }
  if (
    metrics.lastDecisionStable !== null &&
    metrics.lastDecisionStable !== truthStable
  ) {
    metrics.reversals += 1;
  }
  metrics.lastDecisionStable = truthStable;
};

const emitFrames = (input: {
  driver: NeuroSimulatorDriver;
  buffer: NeuroFrameRingBuffer;
  frameCount: number;
  frameDurationMs: number;
  deviceId: string;
  stream: NeuroFrame["stream"];
  startMs: number;
  onFrame: (frame: NeuroFrame, truthStable: boolean) => void;
  truthStable: boolean;
}): number => {
  const {
    driver,
    buffer,
    frameCount,
    frameDurationMs,
    deviceId,
    stream,
    startMs,
    onFrame,
    truthStable,
  } = input;
  let ts = startMs;
  const emitter = driver as unknown as { emitFrame: () => void };
  const unsubscribe = driver.onFrame((frame) => {
    const adjusted: NeuroFrame = {
      ...frame,
      stream,
      deviceId,
      tsRecvMono: ts,
      tsDevice: ts,
    };
    buffer.push(adjusted);
    onFrame(adjusted, truthStable);
    ts += frameDurationMs;
  });
  for (let i = 0; i < frameCount; i += 1) {
    emitter.emitFrame();
  }
  unsubscribe();
  return ts;
};

describe("equilibrium validation harness", () => {
  it("reduces premature commits and reversals versus always-commit", () => {
    const sampleRateHz = 500;
    const frameSize = 25;
    const frameDurationMs = (frameSize / sampleRateHz) * 1000;
    const channelCount = 6;
    const deviceId = "sim-harness";
    const stream: NeuroFrame["stream"] = "eeg";

    const buffer = new NeuroFrameRingBuffer({ maxSeconds: 10 });
    const kernel = new NeurostateKernel(buffer, {
      windowSeconds: 0.5,
      minSamples: 20,
      minSignalRms: 0,
      maxArtifactRatio: 1,
      artifactAbsMax: 10,
      lockStreakRequired: 1,
      gammaAnchorHz: 40,
      gammaAnchorBandwidthHz: 8,
      gammaSurrogateCount: 30,
      gammaSurrogateSeed: 1337,
      gammaMinSamples: 64,
      gammaBaselineAlpha: 0.3,
      gammaArtifactRequireEmg: false,
    });

    const alwaysMetrics = createMetrics();
    const equilibriumMetrics = createMetrics();
    const rStar = 3;
    const dStar = 0.4;
    const holdMsTarget = 150;
    let holdMs = 0;

    const handleFrame = (frame: NeuroFrame, truthStable: boolean) => {
      const now = frame.tsRecvMono + frameDurationMs;
      const result = kernel.tick({ stream, deviceId, now });
      const gammaSyncZ = Number.isFinite(result.state.gamma_sync_z)
        ? (result.state.gamma_sync_z as number)
        : 0;
      const gammaSync = Number.isFinite(result.state.gamma_sync)
        ? (result.state.gamma_sync as number)
        : 0;
      const dispersion = 1 - gammaSync;
      const artifactPass =
        result.state.gamma_artifact_pass === undefined
          ? true
          : result.state.gamma_artifact_pass > 0;
      const inEquilibrium =
        artifactPass && gammaSyncZ >= rStar && dispersion <= dStar;
      holdMs = inEquilibrium ? holdMs + frameDurationMs : 0;
      const equilibrium = holdMs >= holdMsTarget;
      const hasGamma =
        Number.isFinite(result.state.gamma_sync_z) &&
        Number.isFinite(result.state.gamma_sync);

      if (hasGamma) {
        noteCommit(alwaysMetrics, truthStable);
      }
      if (equilibrium) {
        noteCommit(equilibriumMetrics, truthStable);
      }
    };

    withSeededRandom(4242, () => {
      const stableDriver = new NeuroSimulatorDriver({
        stream,
        deviceId,
        sampleRateHz,
        frameSize,
        channelCount,
        signalHz: 40,
        amplitude: 1,
        noiseStd: 0.05,
      });
      const unstableDriver = new NeuroSimulatorDriver({
        stream,
        deviceId,
        sampleRateHz,
        frameSize,
        channelCount,
        signalHz: 12,
        amplitude: 0,
        noiseStd: 0.7,
      });

      let timeline = 0;
      timeline = emitFrames({
        driver: stableDriver,
        buffer,
        frameCount: 20,
        frameDurationMs,
        deviceId,
        stream,
        startMs: timeline,
        onFrame: handleFrame,
        truthStable: true,
      });
      timeline = emitFrames({
        driver: unstableDriver,
        buffer,
        frameCount: 10,
        frameDurationMs,
        deviceId,
        stream,
        startMs: timeline,
        onFrame: handleFrame,
        truthStable: false,
      });
      timeline = emitFrames({
        driver: stableDriver,
        buffer,
        frameCount: 20,
        frameDurationMs,
        deviceId,
        stream,
        startMs: timeline,
        onFrame: handleFrame,
        truthStable: true,
      });
      timeline = emitFrames({
        driver: unstableDriver,
        buffer,
        frameCount: 10,
        frameDurationMs,
        deviceId,
        stream,
        startMs: timeline,
        onFrame: handleFrame,
        truthStable: false,
      });
      emitFrames({
        driver: stableDriver,
        buffer,
        frameCount: 20,
        frameDurationMs,
        deviceId,
        stream,
        startMs: timeline,
        onFrame: handleFrame,
        truthStable: true,
      });
    });

    const accuracyAlways =
      alwaysMetrics.total > 0 ? alwaysMetrics.good / alwaysMetrics.total : 0;
    const accuracyEquilibrium =
      equilibriumMetrics.total > 0
        ? equilibriumMetrics.good / equilibriumMetrics.total
        : 0;

    expect(equilibriumMetrics.total).toBeGreaterThan(0);
    expect(equilibriumMetrics.premature).toBeLessThan(alwaysMetrics.premature);
    expect(equilibriumMetrics.reversals).toBeLessThan(alwaysMetrics.reversals);
    expect(accuracyEquilibrium).toBeGreaterThan(accuracyAlways);
  });
});
