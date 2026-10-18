import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  computeNhm2ExternalNumericalKernelLedgerSha256,
  NHM2_EXTERNAL_NUMERICAL_KERNEL_POLICIES,
  type Nhm2ExternalNumericalKernelLedgerEntryV1,
  type Nhm2ExternalNumericalKernelSealedLedgerV1,
} from "../nhm2-external-numerical-kernel-executor";
import {
  buildNhm2CalculixMechanicsSupportControlExternalPlan,
  NHM2_CALCULIX_2_23_CRITICAL_SOURCE_BINDINGS,
  NHM2_CALCULIX_MECHANICS_INPUT_VERSION,
  NHM2_CALCULIX_OFFICIAL_EXECUTABLE_ARCHIVE_SHA256,
  NHM2_CALCULIX_OFFICIAL_EXECUTABLE_ARCHIVE_SIZE_BYTES,
  NHM2_CALCULIX_OFFICIAL_EXECUTABLE_ARCHIVE_URI,
  NHM2_CALCULIX_OFFICIAL_EXECUTABLE_SHA256,
  NHM2_CALCULIX_OFFICIAL_EXECUTABLE_SIZE_BYTES,
  NHM2_CALCULIX_RELEASE_ARCHIVE_SHA256,
  NHM2_CALCULIX_RELEASE_ARCHIVE_SIZE_BYTES,
  NHM2_CALCULIX_RELEASE_ARCHIVE_URI,
  NHM2_CALCULIX_REPOSITORY,
  NHM2_CALCULIX_VERSION,
  Nhm2CalculixMechanicsPlanError,
  serializeNhm2CalculixMechanicsSupportControlInput,
  validateNhm2CalculixMechanicsSupportControlExternalPlan,
  type Nhm2CalculixMechanicsSupportControlExternalPlanV1,
  type Nhm2CalculixMechanicsSupportControlInputV1,
  type Nhm2CalculixModelDependencyBindingV1,
} from "../nhm2-calculix-mechanics-support-control-external-plan";

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

const compareUtf8 = (left: string, right: string): number =>
  Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));

const makeLedger = (
  rootPath: string,
  kind: "input" | "toolchain",
  entries: Nhm2ExternalNumericalKernelLedgerEntryV1[],
): Nhm2ExternalNumericalKernelSealedLedgerV1 => {
  const sortedEntries = entries
    .map((entry) => ({ ...entry }))
    .sort((left, right) => compareUtf8(left.relativePath, right.relativePath));
  return {
    kind,
    rootPath,
    entries: sortedEntries,
    ledgerSha256: computeNhm2ExternalNumericalKernelLedgerSha256({
      kind,
      entries: sortedEntries,
    }),
  };
};

const dependency = (
  kind: Nhm2CalculixModelDependencyBindingV1["kind"],
  relativePath: string,
  digit: string,
  sizeBytes = 2_048,
): Nhm2CalculixModelDependencyBindingV1 => ({
  kind,
  relativePath,
  sha256: digit.repeat(64),
  sizeBytes,
});

const makeInput = (): Nhm2CalculixMechanicsSupportControlInputV1 => {
  const dependencies = [
    dependency(
      "cad_geometry_receipt",
      "cad/full-apparatus-geometry-receipt.json",
      "1",
    ),
    dependency("fem_include", "deck/contact.inp", "2"),
    dependency("fem_include", "deck/materials.inp", "3"),
    dependency("fem_include", "deck/mesh.inp", "4"),
    dependency(
      "deck_include_closure_receipt",
      "deck/receipts/include-closure.json",
      "5",
    ),
    dependency(
      "deck_semantic_audit_receipt",
      "deck/receipts/semantic-audit.json",
      "6",
    ),
    dependency("mesh", "mesh/full-apparatus.msh", "7", 65_536),
    dependency(
      "mesh_generation_receipt",
      "mesh/full-apparatus-generation.json",
      "8",
    ),
    dependency("material_coupon_receipt", "materials/support-coupon.json", "9"),
    dependency("material_model", "materials/support-material.inp", "a"),
    dependency(
      "scuff_load_transfer_receipt",
      "loads/scuff-traction-transfer.json",
      "b",
    ),
    dependency("scuff_nodal_load_include", "loads/scuff-nodal-loads.inp", "c"),
    dependency("support_model", "models/support-model.json", "d"),
    dependency("control_actuation_model", "models/control-actuation.json", "e"),
    dependency("thermal_model", "models/thermal-boundary.json", "f"),
    dependency("fatigue_model", "models/fatigue.json", "0"),
    dependency("contact_model", "models/contact.json", "1"),
    dependency("pull_in_criterion", "models/pull-in.json", "2"),
  ].sort((left, right) => compareUtf8(left.relativePath, right.relativePath));

  return {
    artifactId: "nhm2.calculix_mechanics_support_control_input",
    contractVersion: NHM2_CALCULIX_MECHANICS_INPUT_VERSION,
    package: {
      name: "CalculiX CrunchiX",
      version: NHM2_CALCULIX_VERSION,
      repository: NHM2_CALCULIX_REPOSITORY,
      releaseArchiveUri: NHM2_CALCULIX_RELEASE_ARCHIVE_URI,
      releaseArchiveSha256: NHM2_CALCULIX_RELEASE_ARCHIVE_SHA256,
      releaseArchiveSizeBytes: NHM2_CALCULIX_RELEASE_ARCHIVE_SIZE_BYTES,
      officialExecutableArchiveUri:
        NHM2_CALCULIX_OFFICIAL_EXECUTABLE_ARCHIVE_URI,
      officialExecutableArchiveSha256:
        NHM2_CALCULIX_OFFICIAL_EXECUTABLE_ARCHIVE_SHA256,
      officialExecutableArchiveSizeBytes:
        NHM2_CALCULIX_OFFICIAL_EXECUTABLE_ARCHIVE_SIZE_BYTES,
      officialExecutableSha256: NHM2_CALCULIX_OFFICIAL_EXECUTABLE_SHA256,
      officialExecutableSizeBytes: NHM2_CALCULIX_OFFICIAL_EXECUTABLE_SIZE_BYTES,
      executablePlatform: "linux",
      executableArchitecture: "x86_64",
      officialGitTag: null,
      sourceAuthority: "official_release_archive",
      executableName: "ccx_2.23",
      harnessOnly: false,
    },
    units: {
      length: "m",
      force: "N",
      time: "s",
      temperature: "K",
      mass: "kg",
      stress: "Pa",
      pressure: "Pa",
      energy: "J",
      heatFlux: "W/m^2",
    },
    model: {
      authority: "full_cad_fem_deck_receipt_bound",
      jobName: "nhm2_mechanics_support_control",
      deckEncoding: "utf8_no_bom_lf",
      includeResolution: "ledger_relative_only",
      mainDeck: {
        relativePath: "deck/nhm2_mechanics_support_control.inp",
        sha256: "3".repeat(64),
        sizeBytes: 8_192,
      },
      dependencies,
    },
    loadTransfer: {
      sourceSolver: "scuff-em",
      sourceLane: "casimir_finite_temperature_maxwell_stress",
      sourceOutputRole: "casimir_stress_traction",
      sourceObservationSha256: "4".repeat(64),
      sourceOutputSha256: "5".repeat(64),
      loadTransferReceiptPath: "loads/scuff-traction-transfer.json",
      nodalLoadIncludePath: "loads/scuff-nodal-loads.inp",
      tractionUnits: "Pa",
      nodalForceUnits: "N",
      coordinateFrameBinding: "same_cad_frame",
      conservativeResultantRelativeTolerance: 1e-5,
      conservativeMomentRelativeTolerance: 1e-5,
    },
    supportControl: {
      supportModelPath: "models/support-model.json",
      controlActuationModelPath: "models/control-actuation.json",
      supportFraction: 0.2,
      minimumStructuralSupportFraction: 0.18,
      maximumSupportFractionForRetention: 0.22,
      supportRetentionOverlapRatio: 0.22 / 0.18,
      supportSafetyFactor: 1.5,
      actuationMode: "prescribed_nodal_force_history",
      actuationChannelCount: 100,
      activeChannelCount: 12,
      actuationPeriodSeconds: 0.01,
      burstDuty: 0.01,
      cycleDuty: 0.03,
      peakCommandForceNewtons: 20_000,
    },
    thermal: {
      thermalModelPath: "models/thermal-boundary.json",
      analysisMode: "transient_coupled_temperature_displacement",
      initialTemperatureKelvin: 293.15,
      ambientTemperatureKelvin: 293.15,
      minimumAllowedTemperatureKelvin: 250,
      maximumAllowedTemperatureKelvin: 450,
      convectionCoefficientWattsPerSquareMeterKelvin: 15,
      emissivity: 0.1,
      cycleCount: 1_000_000,
    },
    fatigue: {
      fatigueModelPath: "models/fatigue.json",
      materialCouponReceiptPath: "materials/support-coupon.json",
      method: "strain_life_coffin_manson",
      meanStressCorrection: "morrow",
      designCycles: 1_000_000,
      minimumLifeFactor: 2,
      maximumMinerDamage: 0.5,
    },
    contact: {
      contactModelPath: "models/contact.json",
      formulation: "surface_to_surface_penalty",
      sliding: "finite",
      normalBehavior: "hard",
      frictionCoefficient: 0.2,
      penaltyScale: 1,
      maximumPenetrationMeters: 1e-10,
    },
    pullIn: {
      criterionPath: "models/pull-in.json",
      criterion: "minimum_gap_and_positive_tangent_stiffness",
      nominalGapMeters: 8e-9,
      minimumAllowedGapMeters: 2e-9,
      maximumClosingDisplacementMeters: 6e-9,
      minimumTangentStiffnessNewtonsPerMeter: 1,
      requiredLoadFactor: 1.2,
    },
    nonlinearTimeStepPolicy: {
      linearSolver: "spooles_serial",
      deterministicThreadCount: 1,
      maximumEquilibriumIterations: 100,
      deckSemanticAuditReceiptPath: "deck/receipts/semantic-audit.json",
      steps: [
        {
          stepId: "thermal_preload",
          procedure: "coupled_temperature_displacement",
          nlgeom: true,
          automaticIncrementation: true,
          initialIncrementSeconds: 0.001,
          totalTimeSeconds: 1,
          minimumIncrementSeconds: 1e-8,
          maximumIncrementSeconds: 0.01,
          integrationAlpha: null,
        },
        {
          stepId: "support_static_ramp",
          procedure: "static",
          nlgeom: true,
          automaticIncrementation: true,
          initialIncrementSeconds: 0.001,
          totalTimeSeconds: 1,
          minimumIncrementSeconds: 1e-8,
          maximumIncrementSeconds: 0.01,
          integrationAlpha: null,
        },
        {
          stepId: "control_actuation_transient",
          procedure: "dynamic_implicit",
          nlgeom: true,
          automaticIncrementation: true,
          initialIncrementSeconds: 1e-6,
          totalTimeSeconds: 0.01,
          minimumIncrementSeconds: 1e-10,
          maximumIncrementSeconds: 1e-4,
          integrationAlpha: -0.05,
        },
        {
          stepId: "pull_in_continuation",
          procedure: "static",
          nlgeom: true,
          automaticIncrementation: true,
          initialIncrementSeconds: 1e-4,
          totalTimeSeconds: 1,
          minimumIncrementSeconds: 1e-10,
          maximumIncrementSeconds: 0.001,
          integrationAlpha: null,
        },
      ],
    },
    requestedOutputs: {
      frdEncoding: "ascii",
      outputEveryIncrement: true,
      fieldVariables: ["U", "S", "E", "PEEQ", "NT", "RF"],
      printVariables: ["RF", "U"],
      convergenceFiles: ["sta", "cvg"],
    },
  };
};

const makePlan = (): Nhm2CalculixMechanicsSupportControlExternalPlanV1 => {
  const fixtureRoot = path.join(os.tmpdir(), "n2c-plan-test");
  const toolchainRoot = path.join(fixtureRoot, "toolchain");
  const inputRoot = path.join(fixtureRoot, "input");
  const outputRoot = path.join(fixtureRoot, "output");
  const executableRelativePath = path.join("bin", "ccx_2.23");
  const executablePortablePath = executableRelativePath
    .split(path.sep)
    .join("/");
  const executableHash = NHM2_CALCULIX_OFFICIAL_EXECUTABLE_SHA256;
  const input = makeInput();
  const manifestRelativePath = "manifest/calculix-input.json";
  const manifestBytes = Buffer.from(
    serializeNhm2CalculixMechanicsSupportControlInput(input),
    "utf8",
  );
  const inputLedger = makeLedger(inputRoot, "input", [
    { ...input.model.mainDeck },
    ...input.model.dependencies.map(
      ({ relativePath, sha256: digest, sizeBytes }) => ({
        relativePath,
        sha256: digest,
        sizeBytes,
      }),
    ),
    {
      relativePath: manifestRelativePath,
      sha256: sha256(manifestBytes),
      sizeBytes: manifestBytes.byteLength,
    },
  ]);
  const toolchainEvidence = {
    sourceArchiveRelativePath: "source/ccx_2.23.src.tar.bz2",
    executableArchiveRelativePath: "source/ccx_2.23.tar.bz2",
    buildReceiptRelativePath: "receipts/ccx-build.json",
    compilerLockRelativePath: "receipts/compiler-lock.json",
    versionObservationRelativePath: "receipts/ccx-version.txt",
  };
  const toolchainLedger = makeLedger(toolchainRoot, "toolchain", [
    {
      relativePath: executablePortablePath,
      sha256: executableHash,
      sizeBytes: NHM2_CALCULIX_OFFICIAL_EXECUTABLE_SIZE_BYTES,
    },
    {
      relativePath: toolchainEvidence.sourceArchiveRelativePath,
      sha256: NHM2_CALCULIX_RELEASE_ARCHIVE_SHA256,
      sizeBytes: NHM2_CALCULIX_RELEASE_ARCHIVE_SIZE_BYTES,
    },
    {
      relativePath: toolchainEvidence.executableArchiveRelativePath,
      sha256: NHM2_CALCULIX_OFFICIAL_EXECUTABLE_ARCHIVE_SHA256,
      sizeBytes: NHM2_CALCULIX_OFFICIAL_EXECUTABLE_ARCHIVE_SIZE_BYTES,
    },
    {
      relativePath: toolchainEvidence.buildReceiptRelativePath,
      sha256: "7".repeat(64),
      sizeBytes: 2_048,
    },
    {
      relativePath: toolchainEvidence.compilerLockRelativePath,
      sha256: "8".repeat(64),
      sizeBytes: 2_048,
    },
    {
      relativePath: toolchainEvidence.versionObservationRelativePath,
      sha256: "9".repeat(64),
      sizeBytes: 128,
    },
    ...NHM2_CALCULIX_2_23_CRITICAL_SOURCE_BINDINGS.map((binding) => ({
      relativePath: `source/${binding.suffix}`,
      sha256: binding.sha256,
      sizeBytes: binding.sizeBytes,
    })),
  ]);
  return buildNhm2CalculixMechanicsSupportControlExternalPlan({
    input,
    inputManifestRelativePath: manifestRelativePath,
    executable: {
      absolutePath: path.join(toolchainRoot, executableRelativePath),
      sha256: executableHash,
      sizeBytes: NHM2_CALCULIX_OFFICIAL_EXECUTABLE_SIZE_BYTES,
    },
    toolchainLedger,
    inputLedger,
    toolchainEvidence,
    outputRoot,
  });
};

const expectPlanFailure = (callback: () => void, code: string): void => {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(Nhm2CalculixMechanicsPlanError);
    expect((error as Nhm2CalculixMechanicsPlanError).code).toBe(code);
    return;
  }
  throw new Error(`Expected CalculiX plan failure ${code}.`);
};

describe("NHM2 CalculiX mechanics/support-control external partial plan", () => {
  it("pins official 2.23 release bytes and seals a deterministic but blocked stock invocation", () => {
    const plan = makePlan();

    expect(() =>
      validateNhm2CalculixMechanicsSupportControlExternalPlan(plan),
    ).not.toThrow();
    expect(plan).toMatchObject({
      status: "sealed_external_partial_plan_execution_blocked",
      lane: "mechanics_nonlinear_support_control",
      solver: {
        family: "calculix",
        implementationId: "calculix.ccx_2_23.stock",
        version: "2.23",
        producerMode: "external_binary",
      },
      executorRunSpec: null,
    });
    expect(plan.deterministicInvocation.arguments).toEqual([
      "-i",
      plan.deterministicInvocation.jobPrefixAbsolutePath,
    ]);
    expect(plan.deterministicInvocation.workingDirectory).toBe(plan.outputRoot);
    expect(plan.freshOutputInventory).toMatchObject({
      exactFinalInventoryKnown: false,
      stockAuxiliaryOutputsMayExist: true,
      stockFilesAssignedGovernedRoles: false,
      requiredGovernedRoles: [
        "mechanics_field_results",
        "mechanics_nonlinear_history",
        "mechanics_solver_report",
      ],
    });
    expect(
      plan.ledgers.toolchain.entries.find(
        (entry) =>
          entry.relativePath ===
          plan.toolchainEvidence.sourceArchiveRelativePath,
      ),
    ).toEqual(
      expect.objectContaining({
        sha256: NHM2_CALCULIX_RELEASE_ARCHIVE_SHA256,
        sizeBytes: NHM2_CALCULIX_RELEASE_ARCHIVE_SIZE_BYTES,
      }),
    );
  });

  it("requires every official critical source byte commitment", () => {
    const plan = makePlan();
    const target = NHM2_CALCULIX_2_23_CRITICAL_SOURCE_BINDINGS[0];
    const entries = plan.ledgers.toolchain.entries.map((entry) =>
      entry.relativePath.endsWith(`/${target.suffix}`)
        ? { ...entry, sha256: "f".repeat(64) }
        : entry,
    );
    plan.ledgers.toolchain = makeLedger(
      plan.ledgers.toolchain.rootPath,
      "toolchain",
      entries,
    );

    expectPlanFailure(
      () => validateNhm2CalculixMechanicsSupportControlExternalPlan(plan),
      "official_calculix_source_binding_invalid",
    );
  });

  it("rejects release-archive substitution even when the toolchain ledger is rehashed", () => {
    const plan = makePlan();
    const archivePath = plan.toolchainEvidence.sourceArchiveRelativePath;
    const entries = plan.ledgers.toolchain.entries.map((entry) =>
      entry.relativePath === archivePath
        ? { ...entry, sha256: "e".repeat(64) }
        : entry,
    );
    plan.ledgers.toolchain = makeLedger(
      plan.ledgers.toolchain.rootPath,
      "toolchain",
      entries,
    );

    expectPlanFailure(
      () => validateNhm2CalculixMechanicsSupportControlExternalPlan(plan),
      "official_calculix_release_archive_invalid",
    );
  });

  it("forbids mock, simulated, and repository-service CalculiX substitutions", () => {
    const plan = makePlan();
    plan.ledgers.toolchain = makeLedger(
      plan.ledgers.toolchain.rootPath,
      "toolchain",
      [
        ...plan.ledgers.toolchain.entries,
        {
          relativePath: "server/services/simulated-calculix.ts",
          sha256: "d".repeat(64),
          sizeBytes: 512,
        },
      ],
    );

    expectPlanFailure(
      () => validateNhm2CalculixMechanicsSupportControlExternalPlan(plan),
      "mock_or_simulated_calculix_forbidden",
    );
  });

  it.each([
    "cad_geometry_receipt",
    "fem_include",
    "material_coupon_receipt",
    "mesh",
    "scuff_load_transfer_receipt",
    "control_actuation_model",
    "thermal_model",
    "fatigue_model",
    "contact_model",
    "pull_in_criterion",
  ] as const)("requires the %s model dependency", (missingKind) => {
    const plan = makePlan();
    const targets = plan.input.model.dependencies.filter(
      (entry) => entry.kind === missingKind,
    );
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) target.kind = "material_model";

    expectPlanFailure(
      () => validateNhm2CalculixMechanicsSupportControlExternalPlan(plan),
      "dependency_inventory_invalid",
    );
  });

  it("rejects portable-path traversal before an unsafe path can enter a plan", () => {
    const plan = makePlan();
    plan.input.model.dependencies[0].relativePath = "../outside/mesh.inp";

    expectPlanFailure(
      () => validateNhm2CalculixMechanicsSupportControlExternalPlan(plan),
      "input_file_binding_invalid",
    );
  });

  it("rejects a rehashed input ledger that drifts from deck or receipt bindings", () => {
    const plan = makePlan();
    const mesh = plan.input.model.dependencies.find(
      (entry) => entry.kind === "mesh",
    );
    expect(mesh).toBeDefined();
    const entries = plan.ledgers.input.entries.map((entry) =>
      entry.relativePath === mesh?.relativePath
        ? { ...entry, sha256: "c".repeat(64) }
        : entry,
    );
    plan.ledgers.input = makeLedger(
      plan.ledgers.input.rootPath,
      "input",
      entries,
    );

    expectPlanFailure(
      () => validateNhm2CalculixMechanicsSupportControlExternalPlan(plan),
      "input_ledger_binding_invalid",
    );
  });

  it("rejects executable escape and wrapper-name substitution", () => {
    const escaped = makePlan();
    escaped.executable.absolutePath = path.join(
      path.dirname(escaped.ledgers.toolchain.rootPath),
      "outside",
      "ccx_2.23",
    );
    expectPlanFailure(
      () => validateNhm2CalculixMechanicsSupportControlExternalPlan(escaped),
      "calculix_executable_binding_invalid",
    );

    const wrapped = makePlan();
    const replacement = "bin/ccx_2.23-wrapper.exe";
    const entries = wrapped.ledgers.toolchain.entries.map((entry) =>
      entry.sha256 === wrapped.executable.sha256 &&
      entry.sizeBytes === wrapped.executable.sizeBytes
        ? { ...entry, relativePath: replacement }
        : entry,
    );
    wrapped.ledgers.toolchain = makeLedger(
      wrapped.ledgers.toolchain.rootPath,
      "toolchain",
      entries,
    );
    wrapped.executable.absolutePath = path.join(
      wrapped.ledgers.toolchain.rootPath,
      ...replacement.split("/"),
    );
    expectPlanFailure(
      () => validateNhm2CalculixMechanicsSupportControlExternalPlan(wrapped),
      "calculix_executable_binding_invalid",
    );
  });

  it("requires pairwise-disjoint immutable input, toolchain, and fresh-output roots", () => {
    const plan = makePlan();
    plan.outputRoot = path.join(plan.ledgers.input.rootPath, "outputs");

    expectPlanFailure(
      () => validateNhm2CalculixMechanicsSupportControlExternalPlan(plan),
      "filesystem_roots_invalid",
    );
  });

  it("rejects a stock job prefix beyond the source-enforced 127-character limit", () => {
    const plan = makePlan();
    plan.ledgers.input.rootPath = path.join(
      os.tmpdir(),
      "x".repeat(120),
      "input",
    );

    expectPlanFailure(
      () => validateNhm2CalculixMechanicsSupportControlExternalPlan(plan),
      "calculix_invocation_invalid",
    );
  });

  it("requires a genuine support-retention overlap window", () => {
    const plan = makePlan();
    plan.input.supportControl.minimumStructuralSupportFraction = 0.18507;
    plan.input.supportControl.maximumSupportFractionForRetention = 0.08497;
    plan.input.supportControl.supportRetentionOverlapRatio = 0.08497 / 0.18507;

    expectPlanFailure(
      () => validateNhm2CalculixMechanicsSupportControlExternalPlan(plan),
      "support_control_policy_invalid",
    );
  });

  it("rejects integrated-force substitution for the required local traction load transfer", () => {
    const plan = makePlan();
    (plan.input.loadTransfer as unknown as Record<string, unknown>).sourceLane =
      "casimir_finite_temperature_integrated_force_sweep";

    expectPlanFailure(
      () => validateNhm2CalculixMechanicsSupportControlExternalPlan(plan),
      "load_transfer_policy_invalid",
    );
  });

  it("freezes nonlinear step order, automatic increments, and implicit dynamic alpha", () => {
    const reordered = makePlan();
    const first = reordered.input.nonlinearTimeStepPolicy.steps[0];
    reordered.input.nonlinearTimeStepPolicy.steps[0] =
      reordered.input.nonlinearTimeStepPolicy.steps[1];
    reordered.input.nonlinearTimeStepPolicy.steps[1] = first;
    expectPlanFailure(
      () => validateNhm2CalculixMechanicsSupportControlExternalPlan(reordered),
      "nonlinear_time_step_policy_invalid",
    );

    const alpha = makePlan();
    alpha.input.nonlinearTimeStepPolicy.steps[2].integrationAlpha = -0.3;
    expectPlanFailure(
      () => validateNhm2CalculixMechanicsSupportControlExternalPlan(alpha),
      "nonlinear_time_step_policy_invalid",
    );
  });

  it("rejects inconsistent pull-in displacement and penetration bounds", () => {
    const closing = makePlan();
    closing.input.pullIn.maximumClosingDisplacementMeters = 7e-9;
    expectPlanFailure(
      () => validateNhm2CalculixMechanicsSupportControlExternalPlan(closing),
      "pull_in_policy_invalid",
    );

    const penetration = makePlan();
    penetration.input.contact.maximumPenetrationMeters = 3e-9;
    expectPlanFailure(
      () =>
        validateNhm2CalculixMechanicsSupportControlExternalPlan(penetration),
      "contact_policy_invalid",
    );
  });

  it("rejects ledger resource-limit attacks", () => {
    const plan = makePlan();
    const entries = plan.ledgers.input.entries.map((entry, index) =>
      index === 0 ? { ...entry, sizeBytes: 2 * 1024 * 1024 * 1024 + 1 } : entry,
    );
    plan.ledgers.input = makeLedger(
      plan.ledgers.input.rootPath,
      "input",
      entries,
    );

    expectPlanFailure(
      () => validateNhm2CalculixMechanicsSupportControlExternalPlan(plan),
      "sealed_ledger_invalid",
    );
  });

  it("rejects harness packages, output-role relabeling, and executor admission", () => {
    const harness = makePlan();
    harness.input.package.harnessOnly = true;
    expectPlanFailure(
      () => validateNhm2CalculixMechanicsSupportControlExternalPlan(harness),
      "harness_package_forbidden",
    );

    const relabelled = makePlan();
    (
      relabelled.freshOutputInventory as unknown as Record<string, unknown>
    ).stockFilesAssignedGovernedRoles = true;
    expectPlanFailure(
      () => validateNhm2CalculixMechanicsSupportControlExternalPlan(relabelled),
      "calculix_claim_boundary_invalid",
    );

    const admitted = makePlan();
    (admitted as unknown as Record<string, unknown>).executorRunSpec = {};
    expectPlanFailure(
      () => validateNhm2CalculixMechanicsSupportControlExternalPlan(admitted),
      "calculix_claim_boundary_invalid",
    );
  });

  it("rejects blocker removal and every authority-claim promotion", () => {
    const blockerPlan = makePlan();
    (blockerPlan as unknown as { blockers: string[] }).blockers =
      blockerPlan.blockers.filter(
        (blocker) => blocker !== "stock_ccx_fatigue_life_postprocessor_absent",
      );
    expectPlanFailure(
      () =>
        validateNhm2CalculixMechanicsSupportControlExternalPlan(blockerPlan),
      "calculix_claim_boundary_invalid",
    );

    const promotedPlan = makePlan();
    (
      promotedPlan.claimBoundary as unknown as Record<string, boolean>
    ).theoryClosureClaimAllowed = true;
    expectPlanFailure(
      () =>
        validateNhm2CalculixMechanicsSupportControlExternalPlan(promotedPlan),
      "calculix_claim_boundary_invalid",
    );
  });

  it("keeps the existing executor lane exact while refusing to forge its three roles", () => {
    const plan = makePlan();

    expect(
      NHM2_EXTERNAL_NUMERICAL_KERNEL_POLICIES.mechanics_nonlinear_support_control,
    ).toEqual({
      solverFamily: "calculix",
      requiredOutputRoles: [
        "mechanics_field_results",
        "mechanics_nonlinear_history",
        "mechanics_solver_report",
      ],
    });
    expect(plan.executorRunSpec).toBeNull();
    expect(plan.blockers).toContain(
      "stock_ccx_job_prefix_couples_input_and_output_roots",
    );
    expect(plan.blockers).toContain(
      "stock_ccx_exact_three_role_output_contract_unavailable",
    );
    expect(plan.claimBoundary).toMatchObject({
      stockExecutableDirectlyAdmitted: false,
      externalExecutionObserved: false,
      mechanicsFieldResultsEstablished: false,
      nonlinearHistoryEstablished: false,
      fatigueLifeEstablished: false,
      pullInMarginEstablished: false,
      supportRetentionOverlapEstablished: false,
      thermalMarginEstablished: false,
      loadTransferEstablished: false,
      theoryClosureClaimAllowed: false,
      empiricalValidationEstablished: false,
      physicalViabilityClaimAllowed: false,
      transportClaimAllowed: false,
      propulsionClaimAllowed: false,
      routeEtaClaimAllowed: false,
      speedAuthorityClaimAllowed: false,
    });
  });
});
