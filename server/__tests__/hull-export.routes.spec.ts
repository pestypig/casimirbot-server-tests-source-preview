import fs from "node:fs/promises";
import path from "node:path";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import express from "express";
import request from "supertest";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { hullExportRouter } from "../routes/hull-export";
import { stableJsonStringify } from "../utils/stable-json";
import { runPythonScript } from "../utils/run-python";
import {
  HULL_SCIENTIFIC_EXPORT_REQUIRED_CHANNELS,
  type HullScientificExportRequestV1,
} from "../../shared/hull-export-contract";
import {
  HULL_RENDER_CERTIFICATE_SCHEMA_VERSION,
  type HullRenderCertificateV1,
  type HullScientificAtlasSidecarV1,
} from "../../shared/hull-render-contract";
import {
  HULL_SCIENTIFIC_ATLAS_PANE_CHANNEL_SETS,
  HULL_SCIENTIFIC_ATLAS_REQUIRED_PANES,
} from "../lib/hull-scientific-atlas-validation";

vi.mock("../utils/run-python", () => ({
  runPythonScript: vi.fn(),
}));

type FixtureOptions = {
  missingChannel?: string;
  timestampMs?: number;
  chart?: string | null;
  certificateHashDriftChannel?: string;
  metricRefUpdatedAt?: number | null;
};

const hashFloat32 = (data: Float32Array): string => {
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return createHash("sha256").update(bytes).digest("hex");
};

const toBase64 = (data: Float32Array): string =>
  Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64");

const buildFixture = (options: FixtureOptions = {}) => {
  const dims: [number, number, number] = [2, 2, 2];
  const voxelSize_m: [number, number, number] = [1, 1, 1];
  const bounds = { min: [-1, -1, -1], max: [1, 1, 1] } as const;
  const total = dims[0] * dims[1] * dims[2];
  const channelHashes: Record<string, string> = {};
  const channels: Record<string, { data: string; min: number; max: number }> = {};
  for (let i = 0; i < HULL_SCIENTIFIC_EXPORT_REQUIRED_CHANNELS.length; i += 1) {
    const channelId = HULL_SCIENTIFIC_EXPORT_REQUIRED_CHANNELS[i];
    if (options.missingChannel === channelId) continue;
    const arr = new Float32Array(total);
    let fill = (i + 1) * 0.01;
    if (channelId === "tile_support_mask") fill = 1;
    if (channelId === "hull_sdf") fill = -1;
    if (
      channelId === "H_constraint" ||
      channelId === "M_constraint_x" ||
      channelId === "M_constraint_y" ||
      channelId === "M_constraint_z"
    ) {
      fill = 0;
    }
    arr.fill(fill);
    channelHashes[channelId] = hashFloat32(arr);
    channels[channelId] = {
      data: toBase64(arr),
      min: fill,
      max: fill,
    };
  }
  const metricVolumeRef = {
    kind: "gr-evolve-brick" as const,
    url: "/api/helix/gr-evolve-brick?quality=low",
    source: "gr-evolve-brick",
    chart: "comoving_cartesian",
    dims,
    updatedAt: options.metricRefUpdatedAt ?? 1_700_000_000_000,
    hash: "metric-ref-hash",
  };
  const certificateBody: Omit<HullRenderCertificateV1, "certificate_hash"> = {
    certificate_schema_version: HULL_RENDER_CERTIFICATE_SCHEMA_VERSION,
    metric_ref_hash: metricVolumeRef.hash,
    channel_hashes: {
      ...channelHashes,
      ...(options.certificateHashDriftChannel
        ? { [options.certificateHashDriftChannel]: "drifted-hash" }
        : {}),
    },
    support_mask_hash: "support-hash",
    chart: options.chart ?? "comoving_cartesian",
    observer: "eulerian_n",
    theta_definition: "theta=-trK",
    kij_sign_convention: "K_ij=-1/2*L_n(gamma_ij)",
    unit_system: "SI",
    camera: { pose: "ui_default_orbit", proj: "perspective_fov60" },
    render: {
      view: "full-atlas",
      integrator: "christoffel-rk4",
      steps: 0,
    },
    diagnostics: {
      null_residual_max: 0,
      step_convergence: 1,
      bundle_spread: 0,
      constraint_rms: 0,
      support_coverage_pct: 100,
    },
    frame_hash: "frame-hash",
    timestamp_ms: options.timestampMs ?? (metricVolumeRef.updatedAt ?? Date.now()),
  };
  const certificate: HullRenderCertificateV1 = {
    ...certificateBody,
    certificate_hash: createHash("sha256")
      .update(stableJsonStringify(certificateBody))
      .digest("hex"),
  };

  const brickPayload = {
    kind: "gr-evolve-brick",
    dims,
    voxelBytes: 4,
    format: "r32f",
    bounds,
    voxelSize_m,
    time_s: 0,
    dt_s: 0,
    channels,
    stats: {},
  };

  const requestPayload: HullScientificExportRequestV1 = {
    version: 1,
    requestId: "export-test-request",
    metricVolumeRef,
    renderCertificate: certificate,
    strictScientific: true,
  };
  return { brickPayload, requestPayload, certificate };
};

const buildAtlas = (certificate: HullRenderCertificateV1): HullScientificAtlasSidecarV1 => {
  const paneStatus = {} as HullScientificAtlasSidecarV1["pane_status"];
  const paneMeta = {} as HullScientificAtlasSidecarV1["pane_meta"];
  const paneChannelSets = {} as HullScientificAtlasSidecarV1["pane_channel_sets"];
  for (const paneId of HULL_SCIENTIFIC_ATLAS_REQUIRED_PANES) {
    const channels = [...(HULL_SCIENTIFIC_ATLAS_PANE_CHANNEL_SETS[paneId] ?? [])];
    const paneChannelHashes: Record<string, string> = {};
    for (const channelId of channels) {
      const hash = certificate.channel_hashes[channelId];
      paneChannelHashes[channelId] =
        typeof hash === "string" && hash.length > 0 ? hash : `h-${channelId}`;
    }
    paneStatus[paneId] = "ok";
    paneChannelSets[paneId] = channels;
    paneMeta[paneId] = {
      status: "ok",
      metric_ref_hash: certificate.metric_ref_hash,
      chart: certificate.chart,
      observer: certificate.observer,
      theta_definition: certificate.theta_definition,
      kij_sign_convention: certificate.kij_sign_convention,
      unit_system: certificate.unit_system,
      timestamp_ms: certificate.timestamp_ms,
      channels,
      channel_hashes: paneChannelHashes,
      integrator:
        paneId === "optical"
          ? certificate.render.integrator
          : paneId === "causal"
            ? "metric-3+1-causal-proxy"
            : null,
      geodesic_mode:
        paneId === "optical" || paneId === "causal"
          ? "full-3+1-christoffel"
          : null,
    };
  }
  return {
    atlas_view: "full-atlas",
    certificate_schema_version: certificate.certificate_schema_version,
    certificate_hash: certificate.certificate_hash,
    metric_ref_hash: certificate.metric_ref_hash,
    pane_ids: [...HULL_SCIENTIFIC_ATLAS_REQUIRED_PANES],
    pane_status: paneStatus,
    pane_channel_sets: paneChannelSets,
    pane_meta: paneMeta,
    chart: certificate.chart,
    observer: certificate.observer,
    theta_definition: certificate.theta_definition,
    kij_sign_convention: certificate.kij_sign_convention,
    unit_system: certificate.unit_system,
    timestamp_ms: certificate.timestamp_ms,
  };
};

const stubSnapshotFetch = (brickPayload: unknown) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify(brickPayload), {
        status: 200,
        headers: { "content-type": "application/json" },
      })),
  );
};

describe("hull-export routes", () => {
  const runPythonMock = vi.mocked(runPythonScript);
  const originalFetch = global.fetch;

  beforeEach(async () => {
    await fs.rm(
      path.resolve(process.cwd(), "artifacts", "research", "hull-export"),
      { recursive: true, force: true },
    );
    runPythonMock.mockReset();
    runPythonMock.mockImplementation(async (_scriptPath, options) => {
      const args = options?.args ?? [];
      const idx = args.indexOf("--manifest");
      if (idx >= 0 && idx + 1 < args.length) {
        const manifestPath = args[idx + 1]!;
        const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
        await fs.writeFile(manifest.output.dataset_h5, Buffer.from("H5STUB"));
        await fs.writeFile(manifest.output.dataset_xdmf, "<Xdmf/>", "utf8");
      }
      return { ok: true };
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    global.fetch = originalFetch;
  });

  it("exports a valid certified dataset package", async () => {
    const { brickPayload, requestPayload, certificate } = buildFixture();
    stubSnapshotFetch(brickPayload);

    const app = express();
    app.use(express.json());
    app.use("/api/helix/hull-export", hullExportRouter);

    const res = await request(app)
      .post("/api/helix/hull-export/dataset")
      .send({ ...requestPayload, scientificAtlas: buildAtlas(certificate) })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.artifacts)).toBe(true);
    expect(res.body.exportSidecar?.export_schema_version).toBe("nhm2.scientific-export.v1");
    expect(res.body.parityReport?.checks?.field_hash_parity?.status).toBe("pass");
    expect(res.body.parityReport?.checks?.metadata_parity?.status).toBe("pass");
  });

  it("fails with scientific_export_certificate_missing when certificate is invalid", async () => {
    const { brickPayload, requestPayload } = buildFixture();
    stubSnapshotFetch(brickPayload);

    const app = express();
    app.use(express.json());
    app.use("/api/helix/hull-export", hullExportRouter);

    const bad = {
      ...requestPayload,
      renderCertificate: {
        ...requestPayload.renderCertificate,
        certificate_hash: "",
      },
    };
    const res = await request(app)
      .post("/api/helix/hull-export/dataset")
      .send(bad)
      .expect(422);

    expect(res.body.failureReason).toBe("scientific_export_certificate_missing");
  });

  it("fails with scientific_export_channel_hash_mismatch on certificate drift", async () => {
    const { brickPayload, requestPayload, certificate } = buildFixture({
      certificateHashDriftChannel: "alpha",
    });
    stubSnapshotFetch(brickPayload);

    const app = express();
    app.use(express.json());
    app.use("/api/helix/hull-export", hullExportRouter);

    const res = await request(app)
      .post("/api/helix/hull-export/dataset")
      .send({ ...requestPayload, scientificAtlas: buildAtlas(certificate) })
      .expect(422);

    expect(res.body.failureReason).toBe("scientific_export_channel_hash_mismatch");
  });

  it("fails with scientific_export_metadata_mismatch on convention drift", async () => {
    const { brickPayload, requestPayload, certificate } = buildFixture({
      chart: "different_chart",
    });
    stubSnapshotFetch(brickPayload);

    const app = express();
    app.use(express.json());
    app.use("/api/helix/hull-export", hullExportRouter);

    const res = await request(app)
      .post("/api/helix/hull-export/dataset")
      .send({ ...requestPayload, scientificAtlas: buildAtlas(certificate) })
      .expect(422);

    expect(res.body.failureReason).toBe("scientific_export_metadata_mismatch");
  });

  it("fails with scientific_export_channel_hash_mismatch when required channel is missing", async () => {
    const { brickPayload, requestPayload, certificate } = buildFixture({
      missingChannel: "alpha",
    });
    stubSnapshotFetch(brickPayload);

    const app = express();
    app.use(express.json());
    app.use("/api/helix/hull-export", hullExportRouter);

    const res = await request(app)
      .post("/api/helix/hull-export/dataset")
      .send({ ...requestPayload, scientificAtlas: buildAtlas(certificate) })
      .expect(422);

    expect(res.body.failureReason).toBe("scientific_export_channel_hash_mismatch");
  });

  it("fails with scientific_export_metadata_mismatch on stale timestamp linkage", async () => {
    const stale = 1_700_000_000_000;
    const { brickPayload, requestPayload, certificate } = buildFixture({
      timestampMs: stale - 10_000_000,
      metricRefUpdatedAt: stale,
    });
    stubSnapshotFetch(brickPayload);

    const app = express();
    app.use(express.json());
    app.use("/api/helix/hull-export", hullExportRouter);

    const res = await request(app)
      .post("/api/helix/hull-export/dataset")
      .send({ ...requestPayload, scientificAtlas: buildAtlas(certificate) })
      .expect(422);

    expect(res.body.failureReason).toBe("scientific_export_metadata_mismatch");
  });

  it("fails with scientific_export_certificate_mismatch when atlas linkage drifts", async () => {
    const { brickPayload, requestPayload, certificate } = buildFixture();
    const mismatchedAtlas = buildAtlas(certificate);
    mismatchedAtlas.certificate_hash = "drifted-atlas-hash";
    stubSnapshotFetch(brickPayload);

    const app = express();
    app.use(express.json());
    app.use("/api/helix/hull-export", hullExportRouter);

    const res = await request(app)
      .post("/api/helix/hull-export/dataset")
      .send({ ...requestPayload, scientificAtlas: mismatchedAtlas })
      .expect(422);

    expect(res.body.failureReason).toBe("scientific_export_certificate_mismatch");
  });

  it("fails with scientific_export_certificate_mismatch when strict request omits atlas", async () => {
    const { brickPayload, requestPayload } = buildFixture();
    stubSnapshotFetch(brickPayload);

    const app = express();
    app.use(express.json());
    app.use("/api/helix/hull-export", hullExportRouter);

    const res = await request(app)
      .post("/api/helix/hull-export/dataset")
      .send(requestPayload)
      .expect(422);

    expect(res.body.failureReason).toBe("scientific_export_certificate_mismatch");
  });

  it("fails with scientific_export_certificate_mismatch when atlas is missing a required pane", async () => {
    const { brickPayload, requestPayload, certificate } = buildFixture();
    const atlas = buildAtlas(certificate);
    atlas.pane_ids = atlas.pane_ids.filter((paneId) => paneId !== "optical");
    atlas.pane_status.optical = "missing";
    stubSnapshotFetch(brickPayload);

    const app = express();
    app.use(express.json());
    app.use("/api/helix/hull-export", hullExportRouter);

    const res = await request(app)
      .post("/api/helix/hull-export/dataset")
      .send({ ...requestPayload, scientificAtlas: atlas })
      .expect(422);

    expect(res.body.failureReason).toBe("scientific_export_certificate_mismatch");
  });

  it("fails with scientific_export_channel_hash_mismatch when pane channel set is missing required channels", async () => {
    const { brickPayload, requestPayload, certificate } = buildFixture();
    const atlas = buildAtlas(certificate);
    atlas.pane_channel_sets.adm = ["alpha", "beta_x"];
    stubSnapshotFetch(brickPayload);

    const app = express();
    app.use(express.json());
    app.use("/api/helix/hull-export", hullExportRouter);

    const res = await request(app)
      .post("/api/helix/hull-export/dataset")
      .send({ ...requestPayload, scientificAtlas: atlas })
      .expect(422);

    expect(res.body.failureReason).toBe("scientific_export_channel_hash_mismatch");
  });

  it("fails with scientific_export_channel_hash_mismatch when pane channel hashes are incomplete", async () => {
    const { brickPayload, requestPayload, certificate } = buildFixture();
    const atlas = buildAtlas(certificate);
    atlas.pane_meta.derived.channel_hashes.theta = "";
    stubSnapshotFetch(brickPayload);

    const app = express();
    app.use(express.json());
    app.use("/api/helix/hull-export", hullExportRouter);

    const res = await request(app)
      .post("/api/helix/hull-export/dataset")
      .send({ ...requestPayload, scientificAtlas: atlas })
      .expect(422);

    expect(res.body.failureReason).toBe("scientific_export_channel_hash_mismatch");
  });

  it("fails with scientific_export_channel_hash_mismatch when derived.theta pane hash is non-empty but mismatched", async () => {
    const { brickPayload, requestPayload, certificate } = buildFixture();
    const atlas = buildAtlas(certificate);
    atlas.pane_meta.derived.channel_hashes.theta = "drifted-theta-hash";
    stubSnapshotFetch(brickPayload);

    const app = express();
    app.use(express.json());
    app.use("/api/helix/hull-export", hullExportRouter);

    const res = await request(app)
      .post("/api/helix/hull-export/dataset")
      .send({ ...requestPayload, scientificAtlas: atlas })
      .expect(422);

    expect(res.body.failureReason).toBe("scientific_export_channel_hash_mismatch");
  });

  it("fails with scientific_export_channel_hash_mismatch when adm.alpha pane hash is non-empty but mismatched", async () => {
    const { brickPayload, requestPayload, certificate } = buildFixture();
    const atlas = buildAtlas(certificate);
    atlas.pane_meta.adm.channel_hashes.alpha = "drifted-alpha-hash";
    stubSnapshotFetch(brickPayload);

    const app = express();
    app.use(express.json());
    app.use("/api/helix/hull-export", hullExportRouter);

    const res = await request(app)
      .post("/api/helix/hull-export/dataset")
      .send({ ...requestPayload, scientificAtlas: atlas })
      .expect(422);

    expect(res.body.failureReason).toBe("scientific_export_channel_hash_mismatch");
  });

  it("fails with scientific_export_metadata_mismatch when pane conventions drift", async () => {
    const { brickPayload, requestPayload, certificate } = buildFixture();
    const atlas = buildAtlas(certificate);
    atlas.pane_meta.causal.chart = "drifted_chart";
    stubSnapshotFetch(brickPayload);

    const app = express();
    app.use(express.json());
    app.use("/api/helix/hull-export", hullExportRouter);

    const res = await request(app)
      .post("/api/helix/hull-export/dataset")
      .send({ ...requestPayload, scientificAtlas: atlas })
      .expect(422);

    expect(res.body.failureReason).toBe("scientific_export_metadata_mismatch");
  });

  it("fails with scientific_export_metadata_mismatch when causal and optical panes are desynchronized", async () => {
    const { brickPayload, requestPayload, certificate } = buildFixture();
    const atlas = buildAtlas(certificate);
    atlas.pane_meta.optical.timestamp_ms = atlas.pane_meta.optical.timestamp_ms + 1;
    stubSnapshotFetch(brickPayload);

    const app = express();
    app.use(express.json());
    app.use("/api/helix/hull-export", hullExportRouter);

    const res = await request(app)
      .post("/api/helix/hull-export/dataset")
      .send({ ...requestPayload, scientificAtlas: atlas })
      .expect(422);

    expect(res.body.failureReason).toBe("scientific_export_metadata_mismatch");
  });
});
