import { afterEach, describe, expect, it } from "vitest";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { readNhm2CanonicalComponent, readNhm2CanonicalEvidence } from "../nhm2-canonical-evidence";

const profile = "stage1_centerline_alpha_0p7000_observer_compatible_source_campaign_screen_v1";
const runRoot = `artifacts/research/full-solve/profile-campaign-runs/${profile}`;
const refs = [
  "artifacts/research/full-solve/profile-search/nhm2-profile-campaign-frontier-latest.json",
  ...[
    "nhm2-time-dependent-source-campaign.json",
    "nhm2-candidate-metric-profile-spec.json",
    "nhm2-source-component-authority-ledger.json",
    "nhm2-regional-full-tensor-residual.json",
    "nhm2-observer-robust-energy-conditions.json",
    "nhm2-qei-worldline-dossier.json",
    "nhm2-lean-campaign-certificate.json",
  ].map((name) => `${runRoot}/${name}`),
];
const temporaryRoots: string[] = [];

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "nhm2-canonical-evidence-"));
  temporaryRoots.push(root);
  for (const ref of refs) {
    const target = path.join(root, ref);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(process.cwd(), ref), target);
  }
  return root;
}

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    expect(path.resolve(root).startsWith(`${path.resolve(tmpdir())}${path.sep}`)).toBe(true);
    await rm(root, { recursive: true, force: true });
  }
});

describe("NHM2 canonical evidence read", () => {
  it("exposes only the pinned diagnostic run with explicit claim locks", async () => {
    const root = await fixture();
    const result = await readNhm2CanonicalEvidence(root);
    expect(result.status).toBe("available");
    expect(result.profile?.id).toBe(profile);
    expect(result.profile?.alphaCenterline).toBe(0.7);
    expect(result.campaign?.campaignPass).toBe(true);
    expect(Object.values(result.campaign?.gates ?? {})).toEqual(Array(8).fill(true));
    expect(Object.values(result.claimLocks)).toEqual(Array(4).fill(false));
    expect(result.components.find((item) => item.id === "casimir_material_receipt")?.status).toBe("not_provided");
    expect(result.answerAuthority).toBe(false);
    const selected = await readNhm2CanonicalComponent("qei_worldlines", result, root);
    expect(selected?.sha256).toBe(result.components.find((item) => item.id === "qei_worldlines")?.sha256);
    expect(selected?.payload.contractVersion).toBe("nhm2_qei_worldline_dossier/v1");
  });

  it("fails closed when a run artifact changes by one byte", async () => {
    const root = await fixture();
    const target = path.join(root, runRoot, "nhm2-time-dependent-source-campaign.json");
    await writeFile(target, `${await readFile(target, "utf8")}\n`);
    const result = await readNhm2CanonicalEvidence(root);
    expect(result.status).toBe("inconsistent");
    expect(result.profile).toBeNull();
    expect(result.components.find((item) => item.id === "campaign")?.status).toBe("hash_mismatch");
    expect(await readNhm2CanonicalComponent("campaign", result, root)).toBeNull();
  });

  it("fails closed when a required worldline dossier is missing", async () => {
    const root = await fixture();
    await rm(path.join(root, runRoot, "nhm2-qei-worldline-dossier.json"));
    const result = await readNhm2CanonicalEvidence(root);
    expect(result.status).toBe("inconsistent");
    expect(result.components.find((item) => item.id === "qei_worldlines")?.status).toBe("missing");
  });
});
