import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readSpaceEngineScenePreview } from "../scene-preview";
import { compileSpaceEngineSceneBundle } from "../scene-bundle";

describe("SpaceEngine source-to-add-on bundle", () => {
  it("binds a fixed scenario and provenance manifest to the pinned Yukawa proxy", async () => {
    const preview = await readSpaceEngineScenePreview({ sceneId: "darkmatter.yukawa_proxy.v1" });
    const bundle = compileSpaceEngineSceneBundle(preview);
    expect(bundle.files.map((item) => item.addonRelativePath)).toEqual([
      "CasimirBot/scripts/darkmatter-yukawa-proxy-v1.se",
      "CasimirBot/provenance/darkmatter-yukawa-proxy-v1.json",
    ]);
    expect(bundle.executionStatus).toBe("not_run");
    expect(bundle.installStatus).toBe("not_staged");
    expect(bundle.files[0].content).toBe(preview.script);
    for (const item of bundle.files) {
      expect(createHash("sha256").update(item.content).digest("hex")).toBe(item.sha256);
    }
    const manifest = JSON.parse(bundle.files[1].content);
    expect(manifest.source.sha256).toBe(preview.source.sha256);
    expect(manifest.authority.measuredDarkMatterDetection).toBe(false);
    expect(manifest.renderMapping.spatialDarkMatterFieldAvailable).toBe(false);
  });

  it("rejects a validly hashed but unapproved scenario", async () => {
    const preview = await readSpaceEngineScenePreview({ sceneId: "darkmatter.yukawa_proxy.v1" });
    const script = preview.script + "SetU ClipHeight -5\n";
    expect(() => compileSpaceEngineSceneBundle({
      ...preview, script, scriptSha256: createHash("sha256").update(script).digest("hex"),
    })).toThrow("SPACEENGINE_SCRIPT_NOT_ALLOWLISTED");
  });
});
