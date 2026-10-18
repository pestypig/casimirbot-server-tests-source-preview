import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const execFileSyncMock = vi.hoisted(() => vi.fn());
const loadCodeLatticeMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
}));

vi.mock("../services/code-lattice/loader", () => ({
  loadCodeLattice: (...args: unknown[]) => loadCodeLatticeMock(...args),
}));

const createAtlasCorpusFile = (expectedFiles: string[]): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "helix-theater-topology-"));
  const filePath = path.join(dir, "atlas-corpus.json");
  const payload = {
    tasks: [{ expected_files: expectedFiles }],
  };
  fs.writeFileSync(filePath, JSON.stringify(payload), "utf8");
  return filePath;
};

const createApp = async () => {
  await vi.resetModules();
  const { helixReasoningTheaterRouter } = await import("../routes/helix/reasoning-theater");
  const app = express();
  app.use("/api/helix", helixReasoningTheaterRouter);
  return app;
};

describe("helix reasoning theater topology endpoint", () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
    loadCodeLatticeMock.mockReset();
    delete process.env.HELIX_THEATER_TOPOLOGY_CACHE_MS;
    delete process.env.HELIX_THEATER_ZONE_DENSE_NODES;
  });

  it("computes ownership and convergence from git + atlas corpus", async () => {
    const atlasPath = createAtlasCorpusFile(["src/a.ts", "src/b.ts", "src/missing.ts"]);
    process.env.HELIX_ASK_ATLAS_CORPUS_PATH = atlasPath;
    execFileSyncMock.mockReturnValue("src/a.ts\nsrc/b.ts\nsrc/c.ts\n");
    loadCodeLatticeMock.mockResolvedValue({ filesIndexed: 999 });

    const app = await createApp();
    const response = await request(app)
      .get("/api/helix/reasoning-theater/topology")
      .expect(200);

    expect(response.body?.baseline?.owned_total).toBe(3);
    expect(response.body?.baseline?.connected_owned).toBe(2);
    expect(response.body?.baseline?.owned_not_connected).toBe(1);
    expect(response.body?.sources?.owned_source).toBe("git_tracked");
    expect(response.body?.sources?.atlas_unique_files).toBe(3);
    expect(response.body?.sources?.atlas_existing_files).toBe(2);
    expect(response.body?.sources?.degraded).toBe(false);
    expect(response.body?.baseline?.convergence_ratio).toBeCloseTo(2 / 3, 6);
    expect(response.body?.baseline?.owned_total).toBe(
      response.body?.baseline?.connected_owned + response.body?.baseline?.owned_not_connected,
    );
  });

  it("falls back to code-lattice ownership and marks degraded when git fails", async () => {
    const atlasPath = createAtlasCorpusFile(["docs/a.md", "server/a.ts"]);
    process.env.HELIX_ASK_ATLAS_CORPUS_PATH = atlasPath;
    execFileSyncMock.mockImplementation(() => {
      throw new Error("git unavailable");
    });
    loadCodeLatticeMock.mockResolvedValue({ filesIndexed: 10 });

    const app = await createApp();
    const response = await request(app)
      .get("/api/helix/reasoning-theater/topology")
      .expect(200);

    expect(response.body?.sources?.owned_source).toBe("code_lattice_fallback");
    expect(response.body?.sources?.degraded).toBe(true);
    expect(response.body?.baseline?.owned_total).toBe(10);
    expect(response.body?.baseline?.connected_owned).toBe(0);
    expect(response.body?.baseline?.owned_not_connected).toBe(10);
    expect(response.body?.baseline?.owned_total).toBe(
      response.body?.baseline?.connected_owned + response.body?.baseline?.owned_not_connected,
    );
  });

  it("returns sanitized presentation contract from config endpoint", async () => {
    const app = await createApp();
    const response = await request(app)
      .get("/api/helix/reasoning-theater/config")
      .expect(200);

    expect(response.body?.retrieval_zone_layer?.presentation?.mode).toBe(
      "convergence_strip_v1",
    );
    expect(response.body?.retrieval_zone_layer?.presentation?.symbolic_model).toBe(
      "constellation_weave",
    );
    expect(response.body?.retrieval_zone_layer?.presentation?.literality).toBe(
      "exact_plus_aura",
    );
    expect(response.body?.retrieval_zone_layer?.presentation?.zone_presence).toBe("ambient_only");
    expect(response.body?.retrieval_zone_layer?.presentation?.map_text).toBe("none");
    expect(response.body?.retrieval_zone_layer?.presentation?.causality_encoding).toBe("map_only");
    expect(response.body?.retrieval_zone_layer?.presentation?.trace_scope).toBe("primary_only");
    expect(response.body?.retrieval_zone_layer?.presentation?.camera_mode).toBe("fixed");
    expect(response.body?.retrieval_zone_layer?.presentation?.path_mode).toBe(
      "full_path_with_event_flow",
    );
    expect(response.body?.retrieval_zone_layer?.presentation?.caption_mode).toBe("one_line");
    expect(response.body?.retrieval_zone_layer?.presentation?.provenance_mode).toBe(
      "strict_exact_only",
    );
    expect(response.body?.retrieval_zone_layer?.presentation?.labels).toBe("none");
    expect(response.body?.retrieval_zone_layer?.presentation?.max_exact_paths_per_event).toBeGreaterThan(
      0,
    );
    expect(response.body?.retrieval_zone_layer?.presentation?.show_phase_tick).toBe(true);
    expect(response.body?.retrieval_zone_layer?.presentation?.show_caption).toBe(true);
    expect(response.body?.retrieval_zone_layer?.presentation?.show_reply_snapshot).toBe(true);
    expect(response.body?.retrieval_zone_layer?.presentation?.unknown_policy).toBe("explicit");
  });

  it("returns file-level atlas graph with mapped/frontier zone assignment", async () => {
    const atlasPath = createAtlasCorpusFile(["src/a.ts", "src/b.ts"]);
    process.env.HELIX_ASK_ATLAS_CORPUS_PATH = atlasPath;
    execFileSyncMock.mockReturnValue("src/a.ts\nsrc/b.ts\nsrc/c.ts\n");
    loadCodeLatticeMock.mockResolvedValue({
      latticeVersion: 7,
      nodes: [
        { nodeId: "n1", filePath: "src/a.ts" },
        { nodeId: "n2", filePath: "src/b.ts" },
        { nodeId: "n3", filePath: "src/c.ts" },
      ],
      edges: [
        { from: "n1", to: "n2" },
        { from: "n2", to: "n3" },
        { from: "n1", to: "n2" },
      ],
    });

    const app = await createApp();
    const response = await request(app)
      .get("/api/helix/reasoning-theater/atlas-graph")
      .expect(200);

    expect(response.body?.stats?.nodes_total).toBe(3);
    expect(response.body?.stats?.edges_total).toBe(2);
    expect(response.body?.stats?.mapped_connected_nodes).toBe(2);
    expect(response.body?.stats?.owned_frontier_nodes).toBe(1);
    expect(response.body?.stats?.uncharted_nodes).toBe(0);
    expect(response.body?.stats?.degraded).toBe(false);
    const nodes = Array.isArray(response.body?.nodes) ? response.body.nodes : [];
    expect(nodes.some((node: { id: string; zone: string }) => node.id === "src/a.ts" && node.zone === "mapped_connected")).toBe(true);
    expect(nodes.some((node: { id: string; zone: string }) => node.id === "src/c.ts" && node.zone === "owned_frontier")).toBe(true);
  });

  it("falls back to degraded empty atlas graph when lattice payload is invalid", async () => {
    const atlasPath = createAtlasCorpusFile(["src/a.ts"]);
    process.env.HELIX_ASK_ATLAS_CORPUS_PATH = atlasPath;
    execFileSyncMock.mockReturnValue("src/a.ts\n");
    loadCodeLatticeMock.mockResolvedValue({ filesIndexed: 10 });

    const app = await createApp();
    const response = await request(app)
      .get("/api/helix/reasoning-theater/atlas-graph")
      .expect(200);

    expect(response.body?.stats?.nodes_total).toBe(0);
    expect(response.body?.stats?.edges_total).toBe(0);
    expect(response.body?.stats?.degraded).toBe(true);
    expect(Array.isArray(response.body?.nodes)).toBe(true);
    expect(Array.isArray(response.body?.edges)).toBe(true);
  });

  it("returns deterministic congruence graph coordinates for selected trees", async () => {
    const atlasPath = createAtlasCorpusFile(["docs/ethos/ideology.json"]);
    process.env.HELIX_ASK_ATLAS_CORPUS_PATH = atlasPath;
    execFileSyncMock.mockReturnValue("docs/ethos/ideology.json\nserver/routes/agi.plan.ts\n");
    loadCodeLatticeMock.mockResolvedValue({ filesIndexed: 2, nodes: [], edges: [] });

    const app = await createApp();
    const first = await request(app)
      .get("/api/helix/reasoning-theater/congruence-graph?treeIds=ideology&primaryTreeId=ideology")
      .expect(200);
    const second = await request(app)
      .get("/api/helix/reasoning-theater/congruence-graph?treeIds=ideology&primaryTreeId=ideology")
      .expect(200);

    expect(first.body?.stats?.trees_total).toBeGreaterThanOrEqual(1);
    expect(first.body?.stats?.nodes_total).toBeGreaterThan(0);
    expect(first.body?.stats?.edges_total).toBeGreaterThan(0);
    expect(first.body?.stats?.degraded).toBe(false);
    expect(first.body?.nodes).toEqual(second.body?.nodes);
    expect(first.body?.edges).toEqual(second.body?.edges);
    const nodes = Array.isArray(first.body?.nodes) ? first.body.nodes : [];
    expect(nodes.every((node: { x: number }) => node.x >= 0 && node.x <= 1)).toBe(true);
    expect(nodes.every((node: { y: number }) => node.y >= 0 && node.y <= 1)).toBe(true);
  });

  it("returns degraded fallback for unknown congruence tree ids", async () => {
    const atlasPath = createAtlasCorpusFile([]);
    process.env.HELIX_ASK_ATLAS_CORPUS_PATH = atlasPath;
    execFileSyncMock.mockReturnValue("README.md\n");
    loadCodeLatticeMock.mockResolvedValue({ filesIndexed: 1, nodes: [], edges: [] });

    const app = await createApp();
    const response = await request(app)
      .get("/api/helix/reasoning-theater/congruence-graph?treeIds=tree_that_does_not_exist")
      .expect(200);

    expect(response.body?.stats?.degraded).toBe(true);
    expect(response.body?.stats?.nodes_total).toBe(0);
    expect(response.body?.stats?.edges_total).toBe(0);
    expect(Array.isArray(response.body?.nodes)).toBe(true);
    expect(Array.isArray(response.body?.edges)).toBe(true);
  });
});
