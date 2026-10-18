import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import {
  computeNhm2ExternalNumericalKernelLedgerSha256,
  type Nhm2ExternalNumericalKernelLedgerEntryV1,
  type Nhm2ExternalNumericalKernelSealedLedgerV1,
} from "../nhm2-external-numerical-kernel-executor";
import {
  buildNhm2WarpaxFrameFreeExternalPlan,
  NHM2_WARPAX_COMMIT_SHA,
  NHM2_WARPAX_FRAME_FREE_DRIVER_SHA256,
  NHM2_WARPAX_FRAME_FREE_INPUT_VERSION,
  NHM2_WARPAX_OFFICIAL_V1_3_CRITICAL_SOURCE_BINDINGS,
  NHM2_WARPAX_REPOSITORY,
  NHM2_WARPAX_TAG,
  NHM2_WARPAX_VERSION,
  Nhm2WarpaxFrameFreePlanError,
  serializeNhm2WarpaxFrameFreeInput,
  type Nhm2WarpaxFrameFreeExternalPlanV1,
  type Nhm2WarpaxFrameFreeInputV1,
  validateNhm2WarpaxFrameFreeExternalPlan,
} from "../nhm2-warpax-frame-free-external-plan";

const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];
const DRIVER_PATH = path.resolve(
  process.cwd(),
  "tools/nhm2/warpax_frame_free_v1_3_driver.py",
);

const compareUtf8 = (left: string, right: string): number =>
  Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

const float64Bytes = (values: readonly number[]): Buffer => {
  const bytes = Buffer.alloc(values.length * 8);
  values.forEach((value, index) => bytes.writeDoubleLE(value, index * 8));
  return bytes;
};

const makeInput = (input: {
  stressEnergySha256: string;
  metricSha256: string;
  harnessOnly: boolean;
}): Nhm2WarpaxFrameFreeInputV1 => ({
  artifactId: "nhm2.warpax_frame_free_input",
  contractVersion: NHM2_WARPAX_FRAME_FREE_INPUT_VERSION,
  package: {
    name: "warpax",
    version: NHM2_WARPAX_VERSION,
    repository: NHM2_WARPAX_REPOSITORY,
    tag: NHM2_WARPAX_TAG,
    commitSha: NHM2_WARPAX_COMMIT_SHA,
    harnessOnly: input.harnessOnly,
  },
  metricSignature: "(-,+,+,+)",
  unitSystem: "geometric_G_eq_c_eq_1",
  stressEnergy: {
    relativePath: "fields/stress-energy.f64le",
    sha256: input.stressEnergySha256,
    shape: [2, 4, 4],
    dtype: "float64",
    byteOrder: "little",
    storageOrder: "row_major",
    indexPosition: "covariant",
    chart: "nhm2_same_chart_v1",
    units: "inverse_length_squared",
  },
  metric: {
    relativePath: "fields/metric.f64le",
    sha256: input.metricSha256,
    shape: [2, 4, 4],
    dtype: "float64",
    byteOrder: "little",
    storageOrder: "row_major",
    indexPosition: "covariant",
    chart: "nhm2_same_chart_v1",
    units: "dimensionless",
  },
  solver: "auto",
  tolerance: 1e-10,
});

const makeLedger = (
  rootPath: string,
  kind: "input" | "toolchain",
  entries: Nhm2ExternalNumericalKernelLedgerEntryV1[],
): Nhm2ExternalNumericalKernelSealedLedgerV1 => {
  const sorted = [...entries].sort((left, right) =>
    compareUtf8(left.relativePath, right.relativePath),
  );
  return {
    rootPath,
    kind,
    entries: sorted,
    ledgerSha256: computeNhm2ExternalNumericalKernelLedgerSha256({
      kind,
      entries: sorted,
    }),
  };
};

async function makePlanFixture(): Promise<Nhm2WarpaxFrameFreeExternalPlanV1> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nhm2-warpax-plan-"));
  temporaryRoots.push(root);
  const stressBytes = float64Bytes(new Array(32).fill(0));
  const metricValues = [
    -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0, 1, 0, 0, 0,
    0, 1, 0, 0, 0, 0, 1,
  ];
  const metricBytes = float64Bytes(metricValues);
  const input = makeInput({
    stressEnergySha256: sha256(stressBytes),
    metricSha256: sha256(metricBytes),
    harnessOnly: false,
  });
  const driverBytes = await fs.readFile(DRIVER_PATH);
  const manifestBytes = Buffer.from(
    serializeNhm2WarpaxFrameFreeInput(input),
    "utf8",
  );
  const toolchainRoot = path.join(root, "toolchain");
  const inputRoot = path.join(root, "input");
  const executableRelativePath =
    process.platform === "win32" ? "python/python.exe" : "python/bin/python3";
  const executableHash = "a".repeat(64);
  const toolchainEntries: Nhm2ExternalNumericalKernelLedgerEntryV1[] = [
    {
      relativePath: executableRelativePath,
      sha256: executableHash,
      sizeBytes: 1_024,
    },
    {
      relativePath: "python/site-packages/warpax-1.3.0.dist-info/METADATA",
      sha256: "b".repeat(64),
      sizeBytes: 128,
    },
    ...NHM2_WARPAX_OFFICIAL_V1_3_CRITICAL_SOURCE_BINDINGS.map((binding) => ({
      relativePath: `python/site-packages/${binding.suffix}`,
      sha256: binding.sha256,
      sizeBytes: binding.sizeBytes,
    })),
  ];
  const inputLedger = makeLedger(inputRoot, "input", [
    {
      relativePath: "driver/warpax_frame_free_v1_3_driver.py",
      sha256: sha256(driverBytes),
      sizeBytes: driverBytes.byteLength,
    },
    {
      relativePath: "fields/metric.f64le",
      sha256: sha256(metricBytes),
      sizeBytes: metricBytes.byteLength,
    },
    {
      relativePath: "fields/stress-energy.f64le",
      sha256: sha256(stressBytes),
      sizeBytes: stressBytes.byteLength,
    },
    {
      relativePath: "warpax-input.json",
      sha256: sha256(manifestBytes),
      sizeBytes: manifestBytes.byteLength,
    },
  ]);
  const toolchainLedger = makeLedger(
    toolchainRoot,
    "toolchain",
    toolchainEntries,
  );
  return buildNhm2WarpaxFrameFreeExternalPlan({
    input,
    inputManifestRelativePath: "warpax-input.json",
    driverRelativePath: "driver/warpax_frame_free_v1_3_driver.py",
    executable: {
      absolutePath: path.join(
        toolchainRoot,
        ...executableRelativePath.split("/"),
      ),
      sha256: executableHash,
      sizeBytes: 1_024,
    },
    toolchainLedger,
    inputLedger,
    outputRoot: path.join(root, "output"),
  });
}

function expectPlanFailure(callback: () => void, code: string): void {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(Nhm2WarpaxFrameFreePlanError);
    expect((error as Nhm2WarpaxFrameFreePlanError).code).toBe(code);
    return;
  }
  throw new Error(`Expected plan failure ${code}.`);
}

const fakeWarpaxSource = (finiteNonTypeMargin = false): string => `
from types import SimpleNamespace
import numpy as np

def certify_grid_frame_free(T_field, g_field, g_inv_field=None, *, solver="auto", tol=1e-10):
    if T_field.shape != (2, 4, 4) or g_field.shape != (2, 4, 4):
        raise ValueError("unexpected fixture shape")
    non_type_margin = 7.0 if ${finiteNonTypeMargin ? "True" : "False"} else np.nan
    return SimpleNamespace(
        he_types=np.array([1.0, 4.0]),
        eigenvalues=np.array([[-2.0, -1.0, 0.5, 1.0], [0.0, 0.0, 0.0, 0.0]]),
        eigenvalues_imag=np.array([[0.0, 0.0, 0.0, 0.0], [0.1, -0.1, 0.0, 0.0]]),
        rho=np.array([2.0, np.nan]),
        pressures=np.array([[-1.0, 0.5, 1.0], [np.nan, np.nan, np.nan]]),
        nec_margins=np.array([1.0, non_type_margin]),
        wec_margins=np.array([1.0, np.nan]),
        sec_margins=np.array([1.0, np.nan]),
        dec_margins=np.array([1.0, np.nan]),
        is_vacuum=np.array([0.0, 0.0]),
        n_type_i=1,
        n_type_ii=0,
        n_type_iii=0,
        n_type_iv=1,
        n_vacuum=0,
        n_total=2,
        max_imag_eigenvalue=0.1,
    )
`;

type DriverFixture = {
  root: string;
  manifestPath: string;
  resultPath: string;
  tracePath: string;
  manifest: Nhm2WarpaxFrameFreeInputV1;
  stressValues: number[];
  metricValues: number[];
  fakeRoot: string;
};

async function makeDriverFixture(input?: {
  finiteNonTypeMargin?: boolean;
  packageVersion?: string;
  harnessOnly?: boolean;
}): Promise<DriverFixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nhm2-warpax-driver-"));
  temporaryRoots.push(root);
  const fakeRoot = path.join(root, "fake-package");
  const inputRoot = path.join(root, "input");
  const outputRoot = path.join(root, "output");
  await fs.mkdir(path.join(fakeRoot, "warpax", "energy_conditions"), {
    recursive: true,
  });
  await fs.mkdir(
    path.join(fakeRoot, `warpax-${input?.packageVersion ?? "1.3.0"}.dist-info`),
    { recursive: true },
  );
  await fs.mkdir(path.join(inputRoot, "fields"), { recursive: true });
  await fs.mkdir(outputRoot);
  await fs.writeFile(path.join(fakeRoot, "warpax", "__init__.py"), "", "utf8");
  await fs.writeFile(
    path.join(fakeRoot, "warpax", "energy_conditions", "__init__.py"),
    "",
    "utf8",
  );
  await fs.writeFile(
    path.join(fakeRoot, "warpax", "energy_conditions", "frame_free.py"),
    fakeWarpaxSource(input?.finiteNonTypeMargin),
    "utf8",
  );
  await fs.writeFile(
    path.join(fakeRoot, "warpax", "energy_conditions", "optimization.py"),
    'raise RuntimeError("BFGS optimizer must not be imported")\n',
    "utf8",
  );
  await fs.writeFile(
    path.join(
      fakeRoot,
      `warpax-${input?.packageVersion ?? "1.3.0"}.dist-info`,
      "METADATA",
    ),
    `Metadata-Version: 2.1\nName: warpax\nVersion: ${input?.packageVersion ?? "1.3.0"}\n`,
    "utf8",
  );
  const stressValues = new Array(32).fill(0) as number[];
  stressValues[0] = 2;
  stressValues[5] = -1;
  stressValues[10] = 0.5;
  stressValues[15] = 1;
  const metricValues = [
    -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0, 1, 0, 0, 0,
    0, 1, 0, 0, 0, 0, 1,
  ];
  const stressBytes = float64Bytes(stressValues);
  const metricBytes = float64Bytes(metricValues);
  const stressPath = path.join(inputRoot, "fields", "stress-energy.f64le");
  const metricPath = path.join(inputRoot, "fields", "metric.f64le");
  await fs.writeFile(stressPath, stressBytes);
  await fs.writeFile(metricPath, metricBytes);
  const manifest = makeInput({
    stressEnergySha256: sha256(stressBytes),
    metricSha256: sha256(metricBytes),
    harnessOnly: input?.harnessOnly ?? true,
  });
  manifest.solver = "generalized";
  const manifestPath = path.join(inputRoot, "warpax-input.json");
  await fs.writeFile(
    manifestPath,
    serializeNhm2WarpaxFrameFreeInput(manifest),
    "utf8",
  );
  return {
    root,
    manifestPath,
    resultPath: path.join(outputRoot, "observer-result.json"),
    tracePath: path.join(outputRoot, "observer-trace.json"),
    manifest,
    stressValues,
    metricValues,
    fakeRoot,
  };
}

async function runHarnessDriver(fixture: DriverFixture): Promise<{
  stdout: string;
  stderr: string;
}> {
  return execFileAsync(
    process.env.NHM2_TEST_PYTHON ?? "python",
    [
      DRIVER_PATH,
      "--input",
      fixture.manifestPath,
      "--result",
      fixture.resultPath,
      "--trace",
      fixture.tracePath,
    ],
    {
      env: {
        ...process.env,
        JAX_ENABLE_X64: "1",
        PYTHONHASHSEED: "0",
        PYTHONNOUSERSITE: "1",
        PYTHONPATH: fixture.fakeRoot,
      },
      windowsHide: true,
    },
  );
}

async function expectDriverFailure(
  fixture: DriverFixture,
  code: string,
): Promise<void> {
  try {
    await runHarnessDriver(fixture);
  } catch (error) {
    const stderr = String((error as { stderr?: string }).stderr ?? "");
    expect(stderr).toContain(`NHM2_WARPAX_DRIVER_ERROR:${code}:`);
    return;
  }
  throw new Error(`Expected driver failure ${code}.`);
}

afterEach(async () => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop();
    if (root != null) await fs.rm(root, { recursive: true, force: true });
  }
});

describe("NHM2 sealed warpax frame-free external plan", () => {
  it("pins the official v1.3 sources, exact executor lane/roles, and closed claims", async () => {
    const plan = await makePlanFixture();

    expect(plan.runSpec).toMatchObject({
      lane: "observer_continuous_optimizer",
      solver: {
        family: "warpax",
        implementationId:
          "warpax.energy_conditions.frame_free.certify_grid_frame_free",
        version: "1.3.0",
        producerMode: "external_binary",
      },
      expectedOutputs: [
        { role: "observer_optimizer_result" },
        { role: "observer_optimizer_trace" },
      ],
    });
    expect(plan.runSpec.arguments).toEqual([
      {
        kind: "input_path",
        relativePath: "driver/warpax_frame_free_v1_3_driver.py",
      },
      { kind: "literal", value: "--input" },
      { kind: "input_path", relativePath: "warpax-input.json" },
      { kind: "literal", value: "--result" },
      { kind: "output_path", relativePath: "observer-result.json" },
      { kind: "literal", value: "--trace" },
      { kind: "output_path", relativePath: "observer-trace.json" },
    ]);
    expect(plan.claimBoundary).toMatchObject({
      typeIAlgebraicAllObserverResultAtSamplesAllowed: true,
      nonTypeIBfgsSubstitutionAllowed: false,
      spatialContinuumCoverageEstablished: false,
      globalIntervalCoverageEstablished: false,
      theoryClosureClaimAllowed: false,
      physicalViabilityClaimAllowed: false,
      transportClaimAllowed: false,
    });
    expect(
      plan.runSpec.ledgers.input.entries.find((entry) =>
        entry.relativePath.endsWith("driver.py"),
      )?.sha256,
    ).toBe(NHM2_WARPAX_FRAME_FREE_DRIVER_SHA256);
  });

  it("rejects a harness package from a governed production plan", async () => {
    const plan = await makePlanFixture();
    plan.input.package.harnessOnly = true;

    expectPlanFailure(
      () => validateNhm2WarpaxFrameFreeExternalPlan(plan),
      "harness_package_forbidden",
    );
  });

  it("rejects solver-family or output-role drift", async () => {
    const plan = await makePlanFixture();
    (plan.runSpec.solver as { family: string }).family = "scuff_em";

    expectPlanFailure(
      () => validateNhm2WarpaxFrameFreeExternalPlan(plan),
      "warpax_plan_solver_invalid",
    );

    const rolePlan = await makePlanFixture();
    rolePlan.runSpec.expectedOutputs[0].role = "uncontrolled_result";
    expectPlanFailure(
      () => validateNhm2WarpaxFrameFreeExternalPlan(rolePlan),
      "warpax_run_spec_invalid",
    );
  });

  it("forbids the legacy simulated SCUFF service explicitly", async () => {
    const plan = await makePlanFixture();
    plan.runSpec.ledgers.toolchain = makeLedger(
      plan.runSpec.ledgers.toolchain.rootPath,
      "toolchain",
      [
        ...plan.runSpec.ledgers.toolchain.entries,
        {
          relativePath: "server/services/scuffem.ts",
          sha256: "c".repeat(64),
          sizeBytes: 10,
        },
      ],
    );

    expectPlanFailure(
      () => validateNhm2WarpaxFrameFreeExternalPlan(plan),
      "legacy_simulated_scuff_forbidden",
    );
  });

  it("rejects replacement of an official frame-free source binding", async () => {
    const plan = await makePlanFixture();
    const entries = plan.runSpec.ledgers.toolchain.entries.map((entry) =>
      entry.relativePath.endsWith("warpax/energy_conditions/frame_free.py")
        ? { ...entry, sha256: "d".repeat(64) }
        : entry,
    );
    plan.runSpec.ledgers.toolchain = makeLedger(
      plan.runSpec.ledgers.toolchain.rootPath,
      "toolchain",
      entries,
    );

    expectPlanFailure(
      () => validateNhm2WarpaxFrameFreeExternalPlan(plan),
      "official_warpax_source_binding_invalid",
    );
  });
});

describe("NHM2 warpax driver with a harness-only fake package", () => {
  it("serializes Type-I algebraic margins and preserves non-Type-I NaNs as unavailable", async () => {
    const fixture = await makeDriverFixture();
    const repeatFixture = await makeDriverFixture();

    const processResult = await runHarnessDriver(fixture);
    await runHarnessDriver(repeatFixture);

    expect(processResult.stdout).toBe("");
    expect(processResult.stderr).toBe("");
    const resultText = await fs.readFile(fixture.resultPath, "utf8");
    const traceText = await fs.readFile(fixture.tracePath, "utf8");
    const result = JSON.parse(resultText) as Record<string, any>;
    const trace = JSON.parse(traceText) as Record<string, any>;
    expect(resultText).toBe(
      await fs.readFile(repeatFixture.resultPath, "utf8"),
    );
    expect(traceText).toBe(await fs.readFile(repeatFixture.tracePath, "utf8"));
    expect(resultText).not.toMatch(/[\r\n]/);
    expect(traceText).not.toMatch(/[\r\n]/);
    expect(result.points[0].typeIAlgebraicResult).toMatchObject({
      authority: "algebraic_all_observer_type_i_at_sample",
      margins: {
        nec: { margin: 1, satisfiedWithinRequestedTolerance: true },
        wec: { margin: 1, satisfiedWithinRequestedTolerance: true },
        sec: { margin: 1, satisfiedWithinRequestedTolerance: true },
        dec: { margin: 1, satisfiedWithinRequestedTolerance: true },
      },
    });
    expect(result.points[1]).toMatchObject({
      hawkingEllisType: "IV",
      typeIAlgebraicResult: null,
      nonTypeIResult: {
        bfgsReplacementUsed: false,
        marginAuthority: "unavailable_non_type_i_no_invariant_rest_frame",
        margins: { nec: null, wec: null, sec: null, dec: null },
      },
    });
    expect(trace.api).toMatchObject({
      module: "warpax.energy_conditions.frame_free",
      callable: "certify_grid_frame_free",
      requestedSolver: "generalized",
      bfgsImportedOrUsed: false,
    });
    expect(trace.packageBinding.harnessOnly).toBe(true);
    expect(trace.validation.officialCriticalSourceHashesValidated).toBe(false);
    expect(trace.blockers).toContain(
      "test_harness_package_not_scientific_evidence",
    );
    expect(trace.claimBoundary).toMatchObject({
      spatialContinuumCoverageEstablished: false,
      globalIntervalCoverageEstablished: false,
      theoryClosureClaimAllowed: false,
      physicalViabilityClaimAllowed: false,
      transportClaimAllowed: false,
      propulsionClaimAllowed: false,
    });
    expect((await fs.readdir(path.dirname(fixture.resultPath))).sort()).toEqual(
      ["observer-result.json", "observer-trace.json"],
    );
  });

  it("independently rejects a raw SHA-256 mismatch", async () => {
    const fixture = await makeDriverFixture();
    fixture.manifest.stressEnergy.sha256 = "0".repeat(64);
    await fs.writeFile(
      fixture.manifestPath,
      serializeNhm2WarpaxFrameFreeInput(fixture.manifest),
      "utf8",
    );

    await expectDriverFailure(fixture, "raw_array_hash_mismatch");
  });

  it("rejects a non-Lorentzian sampled metric", async () => {
    const fixture = await makeDriverFixture();
    fixture.metricValues[0] = 1;
    const bytes = float64Bytes(fixture.metricValues);
    await fs.writeFile(
      path.join(path.dirname(fixture.manifestPath), "fields", "metric.f64le"),
      bytes,
    );
    fixture.manifest.metric.sha256 = sha256(bytes);
    await fs.writeFile(
      fixture.manifestPath,
      serializeNhm2WarpaxFrameFreeInput(fixture.manifest),
      "utf8",
    );

    await expectDriverFailure(fixture, "metric_not_lorentzian");
  });

  it("rejects a nonsymmetric covariant stress-energy tensor", async () => {
    const fixture = await makeDriverFixture();
    fixture.stressValues[1] = 1;
    const bytes = float64Bytes(fixture.stressValues);
    await fs.writeFile(
      path.join(
        path.dirname(fixture.manifestPath),
        "fields",
        "stress-energy.f64le",
      ),
      bytes,
    );
    fixture.manifest.stressEnergy.sha256 = sha256(bytes);
    await fs.writeFile(
      fixture.manifestPath,
      serializeNhm2WarpaxFrameFreeInput(fixture.manifest),
      "utf8",
    );

    await expectDriverFailure(fixture, "stress_energy_not_symmetric");
  });

  it("refuses a finite non-Type-I margin instead of accepting a BFGS-like substitution", async () => {
    const fixture = await makeDriverFixture({ finiteNonTypeMargin: true });

    await expectDriverFailure(fixture, "warpax_non_type_i_margin_promoted");
  });

  it("requires runtime distribution metadata for exactly warpax 1.3.0", async () => {
    const fixture = await makeDriverFixture({ packageVersion: "1.3.1" });

    await expectDriverFailure(fixture, "warpax_version_mismatch");
  });

  it("never accepts fake package bytes as an official production binding", async () => {
    const fixture = await makeDriverFixture({ harnessOnly: false });

    await expectDriverFailure(fixture, "warpax_official_source_unreadable");
  });
});
