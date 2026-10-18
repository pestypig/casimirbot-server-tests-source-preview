import { describe, expect, it } from "vitest";
import { readSpaceEngineOctreeDebugPreview } from "../octree-debug-preview";

describe("SpaceEngine octree debug preview", () => {
  it.each([
    ["procedural_stars", "Set ShowStarOctree true"],
    ["catalog_stars", "Set ShowCatStarOctree true"],
    ["galaxies", "Set ShowGalOctree true"],
    ["land_quadtree", "Set ShowLandQuadtree 1"],
  ] as const)("emits only the documented %s variable", (overlay, command) => {
    const view = readSpaceEngineOctreeDebugPreview({ overlay });
    expect(view.script).toContain(`CheckVersion 990\nSaveVars\n${command}\nWait 10\nRestoreVars`);
    expect(view.capability).toMatchObject({
      debugOverlayAvailableInDocumentedScriptVariables: true,
      nodeDataExposedByDocumentedAPI: false,
      chunkTelemetryExposedByDocumentedAPI: false,
    });
    expect(view.executionStatus).toBe("not_run");
  });

  it("does not accept a caller-selected renderer variable", () => {
    expect(() => readSpaceEngineOctreeDebugPreview({ overlay: "galaxies", variable: "SetU ClipHeight -5" })).toThrow();
    expect(() => readSpaceEngineOctreeDebugPreview({ overlay: "arbitrary" })).toThrow();
  });
});
