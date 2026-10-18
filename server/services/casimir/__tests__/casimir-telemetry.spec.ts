import { describe, it, expect } from "vitest";
import type { ConsoleTelemetryBundle } from "@shared/desktop";
import type { ResonanceBundle } from "@shared/code-lattice";
import { ensureCasimirTelemetry, CASIMIR_PANEL_ID } from "../telemetry";
import { renderChatBPlannerPrompt } from "../../planner/chat-b";

const basePlannerArgs = {
  goal: "check casimir tiles",
  personaId: "default",
  manifest: [],
  searchQuery: "casimir tiles",
  topK: 3,
  summaryFocus: "status",
};

describe("casimir telemetry emitter", () => {
  it("adds casimir panel snapshots into existing bundles", () => {
    const baseTelemetry: ConsoleTelemetryBundle = {
      desktopId: "test.desktop",
      capturedAt: new Date(Date.now() - 5000).toISOString(),
      panels: [
        {
          panelId: "docs-viewer",
          instanceId: "docs-viewer",
          title: "Docs",
          kind: "client",
          metrics: { openDocs: 2 },
          lastUpdated: new Date(Date.now() - 2000).toISOString(),
        },
      ],
    };
    const { bundle, panel } = ensureCasimirTelemetry({ desktopId: "test.desktop", base: baseTelemetry });
    expect(panel.panelId).toBe(CASIMIR_PANEL_ID);
    expect(panel.sourceIds).toContain("server/services/casimir/telemetry.ts");
    expect(bundle.panels).toHaveLength(2);
    expect(bundle.panels.find((p) => p.panelId === CASIMIR_PANEL_ID)).toBeTruthy();
  });
});

describe("planner prompt casimir section", () => {
  it("renders empty section when telemetry is missing", () => {
    const prompt = renderChatBPlannerPrompt({
      ...basePlannerArgs,
      telemetryBundle: null,
      resonanceBundle: null,
    });
    expect(prompt).toContain("[Casimir telemetry]");
    expect(prompt).toContain("status: none");
    expect(prompt).toContain("enable the Casimir tile emitter");
  });

  it("includes activated nodes when telemetry and resonance mention casimir", () => {
    const { bundle: telemetryBundle } = ensureCasimirTelemetry({ desktopId: "dev" });
    const resonanceBundle: ResonanceBundle = {
      goal: "casimir health",
      query: "casimir tiles",
      capturedAt: new Date().toISOString(),
      baseLimit: 5,
      seedCount: 1,
      candidates: [
        {
          id: "patch_local",
          label: "Local resonance",
          mode: "local",
          hops: 2,
          limit: 5,
          score: 0.86,
          summary: "casimir focus",
          stats: { activationTotal: 1.2, telemetryWeight: 0.6, failingTests: 0, activePanels: 1, nodeCount: 1 },
          nodes: [
            {
              id: "server/services/casimir/telemetry.ts#collect",
              symbol: "collectCasimirTelemetry",
              filePath: "server/services/casimir/telemetry.ts",
              score: 0.92,
              kind: "architecture",
              panels: [CASIMIR_PANEL_ID],
            },
          ],
          knowledge: {
            project: { id: "code-resonance", name: "Resonance", type: "code", hashSlug: "code-resonance" },
            summary: "casimir focus",
            files: [],
            approxBytes: 0,
          },
        },
      ],
    };
    const prompt = renderChatBPlannerPrompt({
      ...basePlannerArgs,
      telemetryBundle,
      resonanceBundle,
    });
    expect(prompt).toContain("[Casimir telemetry]");
    expect(prompt).toContain("activated_nodes");
    expect(prompt).toMatch(/server\/services\/casimir\/telemetry\.ts/);
  });
});
