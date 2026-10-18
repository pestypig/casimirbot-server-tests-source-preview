import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

type NoiseGensRouterModule = typeof import("../routes/noise-gens");

const TEST_TIMEOUT_MS = 20000;

const buildTestWav = (durationSeconds = 1): Buffer => {
  const sampleRate = 8000;
  const channels = 1;
  const frameCount = Math.max(1, Math.round(durationSeconds * sampleRate));
  const blockAlign = channels * 2;
  const dataSize = frameCount * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * blockAlign, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (let i = 0; i < frameCount; i += 1) {
    buffer.writeInt16LE(0, offset);
    offset += 2;
  }
  return buffer;
};

const waitForJob = async (
  app: express.Express,
  jobId: string,
  expected: string,
): Promise<any> => {
  for (let i = 0; i < 20; i += 1) {
    const response = await request(app)
      .get(`/api/noise-gens/jobs/${jobId}`)
      .expect(200);
    if (response.body?.status === expected) {
      return response.body;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`job ${jobId} did not reach ${expected}`);
};

const buildApp = async (dataDir: string, remoteMode?: string) => {
  process.env.NOISEGEN_DATA_DIR = dataDir;
  process.env.NOISEGEN_RANK_DELAY_MS = "0";
  if (remoteMode) {
    process.env.NOISEGEN_REMOTE_RENDER = remoteMode;
  } else {
    delete process.env.NOISEGEN_REMOTE_RENDER;
  }
  await vi.resetModules();
  const routes: NoiseGensRouterModule = await import("../routes/noise-gens");
  const app = express();
  app.use(express.json());
  app.use(routes.default);
  return app;
};

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "noisegen-"));
});

afterEach(async () => {
  delete process.env.NOISEGEN_DATA_DIR;
  delete process.env.NOISEGEN_REMOTE_RENDER;
  delete process.env.NOISEGEN_RANK_DELAY_MS;
  if (dataDir) {
    await rm(dataDir, { recursive: true, force: true });
  }
});

describe("noise-gens routes", () => {
  it("persists uploads and serves originals", async () => {
    const app = await buildApp(dataDir);
    const wav = buildTestWav(1);
    const stemA = buildTestWav(1);
    const stemB = buildTestWav(1);
    const upload = await request(app)
      .post("/api/noise-gens/upload")
      .field("title", "Test Track")
      .field("creator", "Helix Lab")
      .attach("instrumental", wav, {
        filename: "test.wav",
        contentType: "audio/wav",
      })
      .attach("stems", stemA, {
        filename: "kick.wav",
        contentType: "audio/wav",
      })
      .attach("stems", stemB, {
        filename: "snare.wav",
        contentType: "audio/wav",
      })
      .expect(200);
    const trackId = upload.body?.trackId;
    expect(trackId).toBeTruthy();

    const originals = await request(app)
      .get("/api/noise-gens/originals")
      .expect(200);
    expect(Array.isArray(originals.body)).toBe(true);
    expect(originals.body.some((entry: any) => entry.id === trackId)).toBe(true);

    await request(app)
      .head(`/originals/${trackId}/instrumental.wav`)
      .expect(200);

    const stems = await request(app)
      .get(`/api/noise-gens/originals/${trackId}/stems`)
      .expect(200);
    expect(Array.isArray(stems.body?.stems)).toBe(true);
    expect(stems.body.stems.length).toBe(2);
    const firstStem = stems.body.stems[0];
    expect(firstStem?.id).toBeTruthy();
    await request(app)
      .head(`/originals/${trackId}/stems/${encodeURIComponent(firstStem.id)}`)
      .expect(200);
  }, TEST_TIMEOUT_MS);

  it("accepts stems-only uploads", async () => {
    const app = await buildApp(dataDir);
    const stemA = buildTestWav(1);
    const stemB = buildTestWav(1);
    const upload = await request(app)
      .post("/api/noise-gens/upload")
      .field("title", "Stem Only")
      .field("creator", "Helix Lab")
      .attach("stems", stemA, {
        filename: "pads.wav",
        contentType: "audio/wav",
      })
      .attach("stems", stemB, {
        filename: "drums.wav",
        contentType: "audio/wav",
      })
      .expect(200);
    const trackId = upload.body?.trackId;
    expect(trackId).toBeTruthy();

    await request(app)
      .head(`/originals/${trackId}/instrumental.wav`)
      .expect(404);

    const stems = await request(app)
      .get(`/api/noise-gens/originals/${trackId}/stems`)
      .expect(200);
    expect(Array.isArray(stems.body?.stems)).toBe(true);
    expect(stems.body.stems.length).toBe(2);
  });

  it("stores Ableton intent snapshots on upload", async () => {
    const app = await buildApp(dataDir);
    const wav = buildTestWav(1);
    const intentXml = await readFile(
      path.join(process.cwd(), "server", "__tests__", "fixtures", "ableton-intent.xml"),
    );
    const upload = await request(app)
      .post("/api/noise-gens/upload")
      .field("title", "Intent Track")
      .field("creator", "Helix Lab")
      .attach("instrumental", wav, {
        filename: "intent.wav",
        contentType: "audio/wav",
      })
      .attach("intent", intentXml, {
        filename: "intent.xml",
        contentType: "application/xml",
      })
      .expect(200);
    const trackId = upload.body?.trackId;
    expect(trackId).toBeTruthy();

    const details = await request(app)
      .get(`/api/noise-gens/originals/${trackId}`)
      .expect(200);
    const snapshot = details.body?.intentSnapshot;
    expect(snapshot).toBeTruthy();
    expect(snapshot.source?.kind).toBe("xml");
    expect(snapshot.globals?.bpm).toBe(128);
    expect(snapshot.globals?.timeSig).toBe("4/4");
    expect(snapshot.summary?.trackCount).toBe(3);
    expect(snapshot.summary?.locatorCount).toBe(2);
    const deviceNames = snapshot.devices?.map((entry: any) => entry.name) ?? [];
    expect(deviceNames).toContain("Eq8");
    expect(deviceNames).toContain("Reverb");
    expect(deviceNames).toContain("Delay");
    expect(typeof snapshot.deviceIntent?.fx?.reverbSend).toBe("number");
    const prefs = details.body?.intentSnapshotPreferences;
    expect(prefs?.applyTempo).toBe(true);
    expect(prefs?.applyMix).toBe(true);
    expect(prefs?.applyAutomation).toBe(false);
  }, TEST_TIMEOUT_MS);

  it("processes remote cover jobs when forced", async () => {
    const app = await buildApp(dataDir, "force");
    const response = await request(app)
      .post("/api/noise-gens/jobs")
      .send({
        originalId: "default",
        barWindows: [{ startBar: 1, endBar: 5 }],
        linkHelix: false,
        forceRemote: true,
      })
      .expect(200);
    const jobId = response.body?.id;
    expect(jobId).toBeTruthy();

    const job = await waitForJob(app, jobId, "ready");
    expect(typeof job.previewUrl).toBe("string");
    expect(job.previewUrl).toContain("/noisegen/previews/");
  });

  it("keeps cover jobs in processing when remote is off", async () => {
    const app = await buildApp(dataDir, "off");
    const response = await request(app)
      .post("/api/noise-gens/jobs")
      .send({
        originalId: "default",
        barWindows: [{ startBar: 1, endBar: 5 }],
        linkHelix: false,
      })
      .expect(200);
    const jobId = response.body?.id;
    expect(jobId).toBeTruthy();

    const job = await request(app)
      .get(`/api/noise-gens/jobs/${jobId}`)
      .expect(200);
    expect(job.body?.status).toBe("processing");
    expect(job.body?.previewUrl).toBeUndefined();
  });

  it("creates legacy generations", async () => {
    const app = await buildApp(dataDir);
    const wav = buildTestWav(1);
    const upload = await request(app)
      .post("/api/noise-gens/upload")
      .field("title", "Legacy Source")
      .field("creator", "Helix Lab")
      .attach("instrumental", wav, {
        filename: "legacy.wav",
        contentType: "audio/wav",
      })
      .expect(200);
    const trackId = upload.body?.trackId;
    expect(trackId).toBeTruthy();

    const job = await request(app)
      .post("/api/noise-gens/generate")
      .send({ originalId: trackId, moodId: "neon-drift" })
      .expect(200);
    const jobId = job.body?.jobId;
    expect(jobId).toBeTruthy();

    await waitForJob(app, jobId, "ready");
    const generations = await request(app)
      .get("/api/noise-gens/generations")
      .expect(200);
    expect(
      generations.body.some(
        (entry: any) => entry.originalId === trackId && entry.mood,
      ),
    ).toBe(true);
  });
});
