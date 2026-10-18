import { describe, it, expect, vi } from "vitest";
import type { ConsoleTelemetryBundle } from "@shared/desktop";
import type { CodeLatticeSnapshot } from "@shared/code-lattice";
import { CODE_LATTICE_VERSION } from "@shared/code-lattice";

const mockSnapshot: CodeLatticeSnapshot = {
  version: CODE_LATTICE_VERSION,
  generatedAt: new Date().toISOString(),
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

import { buildResonanceBundle } from "../resonance";

describe("casimir resonance seeding", () => {
  it("promotes casimir nodes when telemetry points at casimir sources", async () => {
    const telemetry: ConsoleTelemetryBundle = {
      desktopId: "dev",
      capturedAt: new Date().toISOString(),
      panels: [
        {
          panelId: "casimir-tiles",
          instanceId: "casimir-tiles.server",
          title: "Casimir Tiles",
          kind: "server",
          metrics: { attention: 0.8 },
          sourceIds: ["server/services/casimir/telemetry.ts"],
          lastUpdated: new Date().toISOString(),
        },
      ],
    };
    const bundle = await buildResonanceBundle({
      goal: "check casimir telemetry",
      query: "casimir tiles",
      telemetry,
      limit: 5,
    });
    expect(bundle).toBeTruthy();
    const containsCasimirNode =
      bundle?.candidates?.some((patch) =>
        patch.nodes.some((node) => node.filePath.includes("server/services/casimir/telemetry.ts")),
      ) ?? false;
    expect(containsCasimirNode).toBe(true);
  });

  it("adds default provenance metadata when telemetry provenance is missing", async () => {
    const bundle = await buildResonanceBundle({
      goal: "check casimir telemetry",
      query: "casimir tiles",
      telemetry: null,
      limit: 5,
    });
    expect(bundle?.claim_tier).toBe("diagnostic");
    expect(bundle?.certifying).toBe(false);
    expect(bundle?.provenance_class).toBe("inferred");
  });

  it("returns deterministic fail reason in strict mode when provenance is missing", async () => {
    const bundle = await buildResonanceBundle({
      goal: "check casimir telemetry",
      query: "casimir tiles",
      telemetry: null,
      strictProvenance: true,
      limit: 5,
    });
    expect(bundle?.candidates).toEqual([]);
    expect(bundle?.fail_reason).toBe("RESONANCE_SOURCE_PROVENANCE_MISSING");
    expect(bundle?.claim_tier).toBe("diagnostic");
    expect(bundle?.certifying).toBe(false);
  });
});
