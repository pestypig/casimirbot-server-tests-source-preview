import { describe, expect, it } from "vitest";
import type { NeuroFrame } from "../schemas/neuro.schemas.js";
import type { NeuroDriver, NeuroFrameListener } from "../drivers/driver.base.js";
import { NeuroLoopController } from "../loop-controller.js";

const buildSineSeries = (
  frequencyHz: number,
  sampleRateHz: number,
  samples: number,
  phaseOffset = 0,
  noiseStd = 0,
): number[] => {
  const out = new Array<number>(samples);
  for (let i = 0; i < samples; i += 1) {
    const t = i / sampleRateHz;
    const base = Math.sin(2 * Math.PI * frequencyHz * t + phaseOffset);
    const noise = noiseStd > 0 ? noiseStd * (Math.random() * 2 - 1) : 0;
    out[i] = base + noise;
  }
  return out;
};

class TestDriver implements NeuroDriver {
  id = "test-driver";
  kind: "sim" = "sim";
  private running = false;
  private listeners = new Set<NeuroFrameListener>();

  async start(): Promise<void> {
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  onFrame(cb: NeuroFrameListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  emitFrame(frame: NeuroFrame): void {
    if (!this.running) return;
    this.listeners.forEach((listener) => listener(frame));
  }
}

describe("neuro loop controller", () => {
  it("emits feature payloads from simulated frames", async () => {
    const posted: Array<{
      gamma_sync_z?: number;
      phase_dispersion?: number;
    }> = [];
    const controller = new NeuroLoopController({
      postFn: (payload) => {
        posted.push({
          gamma_sync_z: payload.gamma_sync_z,
          phase_dispersion: payload.phase_dispersion,
        });
      },
    });
    const driver = new TestDriver();
    await controller.start({
      sessionId: `neuro-loop-${Date.now()}`,
      sessionType: "lab",
      hostMode: "brain_like",
      stream: "eeg",
      deviceId: "sim-loop",
      postIntervalMs: 0,
      kernel: {
        windowSeconds: 1,
        minSamples: 20,
        minSignalRms: 0,
        maxArtifactRatio: 1,
        artifactAbsMax: 10,
        lockStreakRequired: 1,
        gammaAnchorHz: 40,
        gammaAnchorBandwidthHz: 8,
        gammaSurrogateCount: 20,
        gammaSurrogateSeed: 7,
        gammaMinSamples: 64,
        gammaArtifactRequireEmg: false,
      },
      driverInstance: driver,
    });

    const sampleRateHz = 500;
    const frameSize = 25;
    const samples = sampleRateHz;
    const ch1 = buildSineSeries(40, sampleRateHz, samples, 0, 0.01);
    const ch2 = buildSineSeries(40, sampleRateHz, samples, 0.2, 0.01);
    const frameDurationMs = (frameSize / sampleRateHz) * 1000;

    let frameIndex = 0;
    for (let start = 0; start < samples; start += frameSize) {
      const frame: NeuroFrame = {
        stream: "eeg",
        deviceId: "sim-loop",
        tsRecvMono: frameIndex * frameDurationMs,
        samples: [
          ch1.slice(start, start + frameSize),
          ch2.slice(start, start + frameSize),
        ],
        sampleRateHz,
        channelNames: ["ch-1", "ch-2"],
        units: "uV",
      };
      driver.emitFrame(frame);
      frameIndex += 1;
    }

    expect(posted.length).toBeGreaterThan(0);
    const last = posted[posted.length - 1];
    expect(last.gamma_sync_z ?? 0).toBeGreaterThan(0);
    expect(last.phase_dispersion ?? 1).toBeLessThan(0.6);

    await controller.stop();
  });
});
