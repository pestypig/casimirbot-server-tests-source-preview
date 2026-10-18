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
  buildNhm2ScuffEmForceSweepExternalPlan,
  NHM2_SCUFF_EM_COMMIT_SHA,
  NHM2_SCUFF_EM_CRITICAL_SOURCE_BINDINGS,
  NHM2_SCUFF_EM_FORCE_SWEEP_INPUT_VERSION,
  NHM2_SCUFF_EM_MATSUBARA_PRINT_POLICY,
  NHM2_SCUFF_EM_REPOSITORY,
  NHM2_SCUFF_EM_VERSION,
  Nhm2ScuffEmForceSweepPlanError,
  serializeNhm2ScuffEmForceSweepInput,
  serializeNhm2ScuffEmForceSweepTransformations,
  validateNhm2ScuffEmForceSweepExternalPlan,
  type Nhm2ScuffEmForceSweepExternalPlanV1,
  type Nhm2ScuffEmForceSweepInputV1,
} from "../nhm2-scuff-em-force-sweep-external-plan";

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

const makeInput = (
  temperatureKelvin = 293.15,
): Nhm2ScuffEmForceSweepInputV1 => {
  const input: Nhm2ScuffEmForceSweepInputV1 = {
    artifactId: "nhm2.scuff_em_force_sweep_input",
    contractVersion: NHM2_SCUFF_EM_FORCE_SWEEP_INPUT_VERSION,
    package: {
      name: "scuff-em",
      repository: NHM2_SCUFF_EM_REPOSITORY,
      commitSha: NHM2_SCUFF_EM_COMMIT_SHA,
      version: NHM2_SCUFF_EM_VERSION,
      executableName: "scuff-cas3D",
      noPublishedReleaseAtPin: true,
      harnessOnly: false,
    },
    geometry: {
      authority: "finite_compact_cad_bem",
      compactGeometry: true,
      periodicGeometry: false,
      lengthUnitMeters: 1e-9,
      baseGapMeters: 8e-9,
      movingObjectLabel: "MOVING_TILE",
      forceAxis: "z",
      geometryFile: {
        relativePath: "geometry/nhm2-tile.scuffgeo",
        sha256: "1".repeat(64),
        sizeBytes: 4_096,
      },
      transformationFile: {
        relativePath: "geometry/gap-sweep.trans",
        sha256: "0".repeat(64),
        sizeBytes: 1,
      },
      dependencies: [
        {
          kind: "material_measurement_receipt",
          relativePath: "materials/gold-measurement-receipt.json",
          sha256: "2".repeat(64),
          sizeBytes: 2_048,
        },
        {
          kind: "material_model",
          relativePath: "materials/gold.scuffmaterial",
          sha256: "3".repeat(64),
          sizeBytes: 1_024,
        },
        {
          kind: "mesh",
          relativePath: "mesh/nhm2-tile.msh",
          sha256: "4".repeat(64),
          sizeBytes: 65_536,
        },
        {
          kind: "mesh_generation_receipt",
          relativePath: "receipts/mesh-generation.json",
          sha256: "5".repeat(64),
          sizeBytes: 2_048,
        },
      ],
      sweep: [6e-9, 7e-9, 8e-9, 9e-9, 10e-9].map((separationMeters, index) => ({
        label: `gap_${index.toString().padStart(3, "0")}`,
        separationMeters,
      })),
    },
    thermodynamics: {
      ensemble: "thermal_equilibrium",
      summation: "matsubara",
      temperatureKelvin,
    },
    numerics: {
      absoluteTolerance: 0,
      relativeTolerance: 1e-6,
    },
    requestedQuantities: ["energy", "z_force"],
  };
  const transformationBytes = Buffer.from(
    serializeNhm2ScuffEmForceSweepTransformations(input),
    "utf8",
  );
  input.geometry.transformationFile.sha256 = sha256(transformationBytes);
  input.geometry.transformationFile.sizeBytes = transformationBytes.byteLength;
  return input;
};

const makePlan = (
  temperatureKelvin = 293.15,
): Nhm2ScuffEmForceSweepExternalPlanV1 => {
  const fixtureRoot = path.join(os.tmpdir(), "nhm2-scuff-plan-fixture");
  const toolchainRoot = path.join(fixtureRoot, "toolchain");
  const inputRoot = path.join(fixtureRoot, "input");
  const executableRelativePath = "bin/scuff-cas3D.exe";
  const executableHash = "a".repeat(64);
  const input = makeInput(temperatureKelvin);
  const manifestRelativePath = "nhm2-scuff-force-sweep-input.json";
  const manifestBytes = Buffer.from(
    serializeNhm2ScuffEmForceSweepInput(input),
    "utf8",
  );
  const inputLedger = makeLedger(inputRoot, "input", [
    { ...input.geometry.geometryFile },
    { ...input.geometry.transformationFile },
    ...input.geometry.dependencies.map(
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
  const toolchainLedger = makeLedger(toolchainRoot, "toolchain", [
    {
      relativePath: executableRelativePath,
      sha256: executableHash,
      sizeBytes: 1_048_576,
    },
    ...NHM2_SCUFF_EM_CRITICAL_SOURCE_BINDINGS.map((binding) => ({
      relativePath: `source/${binding.suffix}`,
      sha256: binding.sha256,
      sizeBytes: binding.sizeBytes,
    })),
  ]);
  return buildNhm2ScuffEmForceSweepExternalPlan({
    input,
    inputManifestRelativePath: manifestRelativePath,
    executable: {
      absolutePath: path.join(
        toolchainRoot,
        ...executableRelativePath.split("/"),
      ),
      sha256: executableHash,
      sizeBytes: 1_048_576,
    },
    toolchainLedger,
    inputLedger,
    outputRoot: path.join(fixtureRoot, "output"),
  });
};

const expectPlanFailure = (callback: () => void, code: string): void => {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(Nhm2ScuffEmForceSweepPlanError);
    expect((error as Nhm2ScuffEmForceSweepPlanError).code).toBe(code);
    return;
  }
  throw new Error(`Expected SCUFF-EM plan failure ${code}.`);
};

describe("NHM2 sealed SCUFF-EM integrated force-sweep external plan", () => {
  it("builds a governed finite-temperature finite-geometry plan with exact source pins", () => {
    const plan = makePlan();

    expect(() => validateNhm2ScuffEmForceSweepExternalPlan(plan)).not.toThrow();
    expect(plan).toMatchObject({
      status: "sealed_external_partial_execution_plan",
      runSpec: {
        lane: "casimir_finite_temperature_integrated_force_sweep",
        solver: {
          family: "scuff_em",
          implementationId: "scuff-em.scuff-cas3D.integrated_force_sweep",
          version: NHM2_SCUFF_EM_VERSION,
          producerMode: "external_binary",
        },
      },
    });
    expect(plan.runSpec.arguments).toContainEqual({
      kind: "literal",
      value: "--Temperature",
    });
    expect(plan.runSpec.arguments).toContainEqual({
      kind: "literal",
      value: "--Energy",
    });
    expect(plan.runSpec.arguments).toContainEqual({
      kind: "literal",
      value: "--ZForce",
    });
    expect(plan.runSpec.expectedOutputs.map(({ role }) => role)).toEqual([
      "casimir_integrated_force_sweep",
      "casimir_matsubara_spectrum",
      "casimir_solver_log",
    ]);
    for (const binding of NHM2_SCUFF_EM_CRITICAL_SOURCE_BINDINGS) {
      expect(
        plan.runSpec.ledgers.toolchain.entries.filter((entry) =>
          entry.relativePath.endsWith(`/${binding.suffix}`),
        ),
      ).toEqual([
        expect.objectContaining({
          sha256: binding.sha256,
          sizeBytes: binding.sizeBytes,
        }),
      ]);
    }
  });

  it("rejects drift in any official SCUFF-EM critical source pin", () => {
    const plan = makePlan();
    const target = NHM2_SCUFF_EM_CRITICAL_SOURCE_BINDINGS[0];
    const entries = plan.runSpec.ledgers.toolchain.entries.map((entry) =>
      entry.relativePath.endsWith(`/${target.suffix}`)
        ? { ...entry, sha256: "f".repeat(64) }
        : entry,
    );
    plan.runSpec.ledgers.toolchain = makeLedger(
      plan.runSpec.ledgers.toolchain.rootPath,
      "toolchain",
      entries,
    );

    expectPlanFailure(
      () => validateNhm2ScuffEmForceSweepExternalPlan(plan),
      "official_scuff_source_binding_invalid",
    );
  });

  it("forbids substitution of the legacy simulated SCUFF service", () => {
    const plan = makePlan();
    plan.runSpec.ledgers.toolchain = makeLedger(
      plan.runSpec.ledgers.toolchain.rootPath,
      "toolchain",
      [
        ...plan.runSpec.ledgers.toolchain.entries,
        {
          relativePath: "server/services/scuffem.ts",
          sha256: "6".repeat(64),
          sizeBytes: 512,
        },
      ],
    );

    expectPlanFailure(
      () => validateNhm2ScuffEmForceSweepExternalPlan(plan),
      "legacy_simulated_scuff_forbidden",
    );
  });

  it("rejects transformation-byte commitments that do not encode the frozen sweep", () => {
    const plan = makePlan();
    plan.input.geometry.transformationFile.sha256 = "7".repeat(64);

    expectPlanFailure(
      () => validateNhm2ScuffEmForceSweepExternalPlan(plan),
      "transformation_binding_invalid",
    );
  });

  it("rejects a nonsymmetric force sweep even when its points remain increasing", () => {
    const plan = makePlan();
    plan.input.geometry.sweep[3].separationMeters = 9.1e-9;

    expectPlanFailure(
      () => validateNhm2ScuffEmForceSweepExternalPlan(plan),
      "force_sweep_invalid",
    );
  });

  it("rejects temperatures whose printed xi_1 term is not distinct above the XIMIN xi_0 proxy", () => {
    const ambiguityTemperature =
      NHM2_SCUFF_EM_MATSUBARA_PRINT_POLICY.ximinRawScuff /
      (2 *
        Math.PI *
        NHM2_SCUFF_EM_MATSUBARA_PRINT_POLICY.boltzmannKInternalPerKelvin);

    expectPlanFailure(
      () => makePlan(ambiguityTemperature),
      "thermodynamic_binding_invalid",
    );
    expect(() => makePlan(ambiguityTemperature * 1.01)).not.toThrow();
  });

  it.each(["material_measurement_receipt", "mesh_generation_receipt"] as const)(
    "requires the %s dependency receipt",
    (missingKind) => {
      const plan = makePlan();
      const dependency = plan.input.geometry.dependencies.find(
        (entry) => entry.kind === missingKind,
      );
      expect(dependency).toBeDefined();
      if (dependency != null) dependency.kind = "geometry_auxiliary";

      expectPlanFailure(
        () => validateNhm2ScuffEmForceSweepExternalPlan(plan),
        "dependency_inventory_invalid",
      );
    },
  );

  it("rejects an internally re-hashed input ledger that drifts from the manifest", () => {
    const plan = makePlan();
    const geometryPath = plan.input.geometry.geometryFile.relativePath;
    const entries = plan.runSpec.ledgers.input.entries.map((entry) =>
      entry.relativePath === geometryPath
        ? { ...entry, sha256: "8".repeat(64) }
        : entry,
    );
    plan.runSpec.ledgers.input = makeLedger(
      plan.runSpec.ledgers.input.rootPath,
      "input",
      entries,
    );

    expectPlanFailure(
      () => validateNhm2ScuffEmForceSweepExternalPlan(plan),
      "input_ledger_binding_invalid",
    );
  });

  it("rejects executable escape from the sealed toolchain", () => {
    const plan = makePlan();
    plan.runSpec.executable.absolutePath = path.join(
      path.dirname(plan.runSpec.ledgers.toolchain.rootPath),
      "outside",
      "scuff-cas3D.exe",
    );

    expectPlanFailure(
      () => validateNhm2ScuffEmForceSweepExternalPlan(plan),
      "scuff_executable_binding_invalid",
    );
  });

  it("rejects a ledger-bound executable-name substitution inside the toolchain", () => {
    const plan = makePlan();
    const replacementRelativePath = "bin/scuff-cas3D-wrapper.exe";
    const entries = plan.runSpec.ledgers.toolchain.entries.map((entry) =>
      entry.sha256 === plan.runSpec.executable.sha256 &&
      entry.sizeBytes === plan.runSpec.executable.sizeBytes
        ? { ...entry, relativePath: replacementRelativePath }
        : entry,
    );
    plan.runSpec.ledgers.toolchain = makeLedger(
      plan.runSpec.ledgers.toolchain.rootPath,
      "toolchain",
      entries,
    );
    plan.runSpec.executable.absolutePath = path.join(
      plan.runSpec.ledgers.toolchain.rootPath,
      ...replacementRelativePath.split("/"),
    );

    expectPlanFailure(
      () => validateNhm2ScuffEmForceSweepExternalPlan(plan),
      "scuff_executable_binding_invalid",
    );
  });

  it("rejects solver or governed output weakening", () => {
    const solverPlan = makePlan();
    solverPlan.runSpec.solver.implementationId = "scuff-em.unreviewed-wrapper";
    expectPlanFailure(
      () => validateNhm2ScuffEmForceSweepExternalPlan(solverPlan),
      "scuff_plan_solver_invalid",
    );

    const outputPlan = makePlan();
    outputPlan.runSpec.expectedOutputs =
      outputPlan.runSpec.expectedOutputs.filter(
        ({ role }) => role !== "casimir_matsubara_spectrum",
      );
    expectPlanFailure(
      () => validateNhm2ScuffEmForceSweepExternalPlan(outputPlan),
      "scuff_run_spec_invalid",
    );
  });

  it("rejects blocker removal or promotion of a closed authority claim", () => {
    const blockerPlan = makePlan();
    (blockerPlan as unknown as { blockers: string[] }).blockers =
      blockerPlan.blockers.filter(
        (blocker) =>
          blocker !== "local_maxwell_stress_traction_field_unresolved",
      );
    expectPlanFailure(
      () => validateNhm2ScuffEmForceSweepExternalPlan(blockerPlan),
      "scuff_claim_boundary_invalid",
    );

    const promotedPlan = makePlan();
    (
      promotedPlan.claimBoundary as unknown as Record<string, boolean>
    ).physicalViabilityClaimAllowed = true;
    expectPlanFailure(
      () => validateNhm2ScuffEmForceSweepExternalPlan(promotedPlan),
      "scuff_claim_boundary_invalid",
    );
  });

  it("keeps the new executor lane at integrated-force partial authority", () => {
    const plan = makePlan();

    expect(
      NHM2_EXTERNAL_NUMERICAL_KERNEL_POLICIES.casimir_finite_temperature_integrated_force_sweep,
    ).toEqual({
      solverFamily: "scuff_em",
      requiredOutputRoles: [
        "casimir_integrated_force_sweep",
        "casimir_matsubara_spectrum",
        "casimir_solver_log",
      ],
    });
    expect(plan.blockers).toContain(
      "local_maxwell_stress_traction_field_unresolved",
    );
    expect(plan.blockers).toContain(
      "source_to_binary_reproducible_build_receipt_required",
    );
    expect(plan.blockers).toContain("scuff_output_si_conversion_unresolved");
    expect(plan.claimBoundary).toMatchObject({
      rawScuffIntegratedEnergyAndZForceOutputAllowedAfterReplay: true,
      siUnitConversionEstablished: false,
      forceGradientEstablished: false,
      localMaxwellStressTractionFieldEstablished: false,
      meshConvergenceEstablished: false,
      materialMeasurementCorrespondenceEstablished: false,
      theoryClosureClaimAllowed: false,
      empiricalValidationEstablished: false,
      physicalViabilityClaimAllowed: false,
      transportClaimAllowed: false,
      propulsionClaimAllowed: false,
      routeEtaClaimAllowed: false,
      speedAuthorityClaimAllowed: false,
    });
    expect(plan.runSpec.expectedOutputs.map(({ role }) => role)).not.toContain(
      "casimir_stress_traction",
    );
  });
});
