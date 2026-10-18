import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSpaceEngineScenePreview } from "../scene-preview";
import { compileSpaceEngineSceneBundle } from "../scene-bundle";
import { planSpaceEngineBundleStage } from "../stage-plan";

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), "spaceengine-stage-plan-")); });
afterEach(async () => {
  if (!path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error("UNSAFE_TEST_CLEANUP");
  await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const preview = await readSpaceEngineScenePreview({ sceneId: "darkmatter.yukawa_proxy.v1" });
  const bundle = compileSpaceEngineSceneBundle(preview);
  const installation = {
    installationRoot: root,
    executable: path.join(root, "system", "SpaceEngine.exe"),
    manifestBuildId: "19191665",
    targetBuildId: null,
    installationIdentity: "a".repeat(20),
    librariesChecked: 1,
  };
  return { bundle, installation };
}

describe("SpaceEngine add-on staging preflight", () => {
  it("reports exact files as missing, then matching without modifying them", async () => {
    const { bundle, installation } = await fixture();
    const missing = await planSpaceEngineBundleStage(bundle, installation);
    expect(missing.status).toBe("ready");
    expect(missing.files.map((item) => item.state)).toEqual(["missing", "missing"]);
    expect(missing).not.toHaveProperty("installationRoot");
    for (const item of bundle.files) {
      const target = path.join(root, "addons", ...item.addonRelativePath.split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, item.content);
    }
    const present = await planSpaceEngineBundleStage(bundle, installation);
    expect(present.status).toBe("already_present");
    expect(present.files.map((item) => item.state)).toEqual(["matching", "matching"]);
    expect(present.rendererActionAuthorized).toBe(false);
  });

  it("fails closed on collisions and forged bundle bytes", async () => {
    const { bundle, installation } = await fixture();
    const target = path.join(root, "addons", "CasimirBot", "scripts", "darkmatter-yukawa-proxy-v1.se");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "different user content\n");
    expect((await planSpaceEngineBundleStage(bundle, installation)).status).toBe("conflict");
    await expect(planSpaceEngineBundleStage({
      ...bundle, files: [{ ...bundle.files[0], content: "tampered" }, bundle.files[1]],
    }, installation)).rejects.toThrow("SPACEENGINE_BUNDLE_INTEGRITY_FAILED");
  });

  it("rejects a redirected addon directory", async () => {
    const { bundle, installation } = await fixture();
    await mkdir(path.join(root, "elsewhere"));
    await symlink(path.join(root, "elsewhere"), path.join(root, "addons"), "junction");
    expect((await planSpaceEngineBundleStage(bundle, installation)).status).toBe("path_rejected");
  });
});
