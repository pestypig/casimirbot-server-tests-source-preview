import { describe, it, expect, vi } from "vitest";
import type { ConsoleTelemetryBundle } from "@shared/desktop";
import type { CodeLatticeSnapshot, ResonanceBundle, ResonancePatch } from "@shared/code-lattice";
import { CODE_LATTICE_VERSION } from "@shared/code-lattice";
import type { KnowledgeProjectExport } from "@shared/knowledge";
import { buildResonanceBundle } from "../resonance";
import { collapseResonancePatches } from "../../planner/chat-b";

const nowIso = () => new Date().toISOString();

const knowledgeStub: KnowledgeProjectExport = {
  project: { id: "code-resonance-test", name: "code-resonance-test", type: "code", hashSlug: "stub" },
  summary: "stub",
  files: [],
  approxBytes: 0,
};

const mockSnapshot: CodeLatticeSnapshot = {
  version: CODE_LATTICE_VERSION,
  generatedAt: nowIso(),
  repoRoot: process.cwd(),
  commit: "test",
  filesIndexed: 1,
  latticeVersion: 1,
  nodes: [
    {
      nodeId: "server/services/casimir/telemetry.ts#collectCasimirTelemetry",
      symbol: "collectCasimirTelemetry",
      exportName: "collectCasimirTelemetry",
      kind: "architecture",
      filePath: "server/services/casimir/telemetry.ts",
      signature: "export function collectCasimirTelemetry()",
      astHash: "hash",
      fileHash: "file",
      byteRange: { start: 0, end: 1 },
      loc: { startLine: 1, startCol: 0, endLine: 1, endCol: 1 },
      snippet: "export function collectCasimirTelemetry() {}",
      neighbors: [],
      salience: { attention: 0.5, activePanels: ["casimir-tiles"] },
      health: { lastStatus: "pass" },
      resonanceKind: "architecture",
      tags: ["casimir"],
    } as any,
  ],
  edges: [],
  envelopes: [],
};

vi.mock("../loader", () => ({
  loadCodeLattice: vi.fn(async () => mockSnapshot),
  getLatticeVersion: vi.fn(() => mockSnapshot.latticeVersion ?? 1),
}));

describe("casimir resonance seeding", () => {
  it("emits casimir band seeds and biases the local blueprint", async () => {
    const telemetry: ConsoleTelemetryBundle = {
      desktopId: "dev",
      capturedAt: nowIso(),
      panels: [
        {
          panelId: "casimir-tiles",
          instanceId: "casimir-tiles.server",
          title: "Casimir Tiles",
          kind: "casimir",
          bands: [
            {
              name: "mhz",
              q: 0.56,
              coherence: 0.37,
              occupancy: 4 / 4096,
              event_rate: 12,
              last_event: nowIso(),
            },
          ],
          tile_sample: { total: 4096, active: 4 },
          metrics: { tilesActive: 4, totalTiles: 4096, avgQFactor: 0.56, coherence: 0.37 },
          sourceIds: ["server/services/casimir/telemetry.ts"],
          lastUpdated: nowIso(),
        },
      ],
    };
    const bundle = await buildResonanceBundle({
      goal: "check casimir telemetry",
      query: "casimir tiles",
      telemetry,
      limit: 5,
    });
    expect(bundle?.telemetry?.casimir?.bands?.[0]?.seed ?? 0).toBeGreaterThan(0);
    const localScore = bundle?.candidates.find((patch) => patch.id === "patch_local")?.score ?? 0;
    const moduleScore = bundle?.candidates.find((patch) => patch.id === "patch_module")?.score ?? 0;
    expect(localScore).toBeGreaterThanOrEqual(moduleScore);
  });

  it("promotes a non-plumbing patch when casimir coherence is high", () => {
    const plumbingPatch: ResonancePatch = {
      id: "patch_plumbing",
      label: "Plumbing heavy",
      mode: "local",
      hops: 1,
      limit: 3,
      score: 0.6,
      summary: "plumbing-only",
      stats: { activationTotal: 1, telemetryWeight: 0, failingTests: 0, activePanels: 0, nodeCount: 3 },
      nodes: [
        { id: "n1", symbol: "pipe1", filePath: "plumb/a.ts", score: 0.3, kind: "plumbing" },
        { id: "n2", symbol: "pipe2", filePath: "plumb/b.ts", score: 0.2, kind: "plumbing" },
        { id: "n3", symbol: "pipe3", filePath: "plumb/c.ts", score: 0.1, kind: "plumbing" },
      ],
      knowledge: knowledgeStub,
    };
    const architecturePatch: ResonancePatch = {
      id: "patch_architecture",
      label: "Architecture",
      mode: "ideology",
      hops: 1,
      limit: 3,
      score: 0.55,
      summary: "architecture-first",
      stats: { activationTotal: 1.2, telemetryWeight: 0, failingTests: 0, activePanels: 0, nodeCount: 2 },
      nodes: [
        { id: "a1", symbol: "arch", filePath: "arch/a.ts", score: 0.6, kind: "architecture" },
        { id: "a2", symbol: "ideology", filePath: "arch/b.ts", score: 0.6, kind: "ideology" },
      ],
      knowledge: knowledgeStub,
    };
    const bundle: ResonanceBundle = {
      goal: "casimir aware plan",
      query: "casimir tiles",
      capturedAt: nowIso(),
      baseLimit: 3,
      seedCount: 3,
      telemetry: { casimir: { bands: [{ name: "ghz", seed: 0.3, coherence: 0.7 }], totalCoherence: 0.7 } },
      candidates: [plumbingPatch, architecturePatch],
    };
    const result = collapseResonancePatches({ bundle, goal: "architectural path", jitter: 0 });
    expect(result?.primaryPatchId).toBe("patch_architecture");
    expect(result?.backupPatchId).toBe("patch_plumbing");
  });


  it("preserves provided provenance metadata on resonance outputs", async () => {
    const telemetry: ConsoleTelemetryBundle = {
      desktopId: "dev",
      capturedAt: nowIso(),
      panels: [
        {
          panelId: "casimir-tiles",
          instanceId: "casimir-tiles.server",
          title: "Casimir Tiles",
          kind: "casimir",
          sourceIds: ["server/services/casimir/telemetry.ts"],
          lastUpdated: nowIso(),
        },
      ],
      provenance_class: "measured",
      claim_tier: "reduced-order",
      certifying: false,
    } as ConsoleTelemetryBundle;

    const bundle = await buildResonanceBundle({
      goal: "casimir provenance",
      query: "casimir tiles",
      telemetry,
      limit: 5,
    });

    expect(bundle?.provenance_class).toBe("measured");
    expect(bundle?.claim_tier).toBe("reduced-order");
    expect(bundle?.certifying).toBe(false);
  });
});
