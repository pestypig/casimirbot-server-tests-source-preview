import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  NHM2_INDEPENDENT_NUMERICAL_REPLICATION_REQUIRED_FIELDS,
} from "../../../../shared/contracts/nhm2-independent-numerical-replication.v1";
import {
  NHM2_PRIMARY_COMPARISON_PROJECTION_FIELD_POLICIES,
} from "../../../../shared/contracts/nhm2-primary-comparison-projection.v1";
import {
  NHM2_EXTERNAL_NUMERICAL_KERNEL_OBSERVATION_VERSION,
  type Nhm2ExternalNumericalKernelOutputObservationV1,
} from "../nhm2-external-numerical-kernel-executor";
import {
  assessNhm2IndependentNumericalReplicationContent,
  NHM2_INDEPENDENT_NUMERICAL_PRIMARY_SOURCE_REQUIREMENTS,
} from "../nhm2-independent-numerical-replication-content-assessor";
import {
  NHM2_INDEPENDENT_NUMERICAL_EXECUTION_OBSERVATION_VERSION,
  type Nhm2IndependentNumericalExecutionObservationV1,
} from "../nhm2-independent-numerical-replication-executor";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      fs.rm(root, { recursive: true, force: true }),
    ),
  );
});

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

const outputFixtures = [
  {
    role: "independent_replay_bundle",
    relativePath: "bundle/replay.bin",
    bytes: Buffer.from([1, 2, 3, 4]),
  },
  {
    role: "independent_replay_inventory",
    relativePath: "inventory/replay.json",
    bytes: Buffer.from(JSON.stringify({ opaque: true }), "utf8"),
  },
  {
    role: "independent_replay_trace",
    relativePath: "trace/replay.ndjson",
    bytes: Buffer.from('{"event":"complete"}\n', "utf8"),
  },
] as const;

async function makeFixture(input?: {
  inventoryBytes?: Buffer;
}): Promise<{
  root: string;
  observation: Nhm2IndependentNumericalExecutionObservationV1;
  outputs: Nhm2ExternalNumericalKernelOutputObservationV1[];
}> {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "nhm2-independent-assessment-"),
  );
  roots.push(root);
  const outputs: Nhm2ExternalNumericalKernelOutputObservationV1[] = [];
  for (const fixture of outputFixtures) {
    const bytes =
      fixture.role === "independent_replay_inventory" && input?.inventoryBytes
        ? input.inventoryBytes
        : fixture.bytes;
    const absolutePath = path.join(
      root,
      ...fixture.relativePath.split("/"),
    );
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, bytes);
    const stat = await fs.stat(absolutePath);
    outputs.push({
      role: fixture.role,
      relativePath: fixture.relativePath,
      sha256: sha256(bytes),
      sizeBytes: bytes.byteLength,
      modifiedAt: stat.mtime.toISOString(),
      freshness: "new",
    });
  }
  const observation = {
    artifactId: "nhm2.independent_numerical_execution_observation",
    contractVersion: NHM2_INDEPENDENT_NUMERICAL_EXECUTION_OBSERVATION_VERSION,
    generatedAt: "2026-07-20T12:00:00.000Z",
    status: "execution_observed_scientific_replay_required",
    candidate: {
      manifestPath: "artifacts/candidate.json",
      manifestSha256: "a".repeat(64),
      candidateId: "candidate-1",
    },
    plan: {
      requestId: "request-1",
      runId: "run-1",
      receiptId: "receipt-1",
      runtimeId: "nhm2.experiment_ready_theory.independent",
      solverId: "solver-1",
      implementationId: "implementation-1",
      independenceGroup: "independent-group",
    },
    kernelObservation: {
      artifactId: "nhm2.external_numerical_kernel_observation",
      contractVersion: NHM2_EXTERNAL_NUMERICAL_KERNEL_OBSERVATION_VERSION,
      generatedAt: "2026-07-20T12:01:00.000Z",
      status: "execution_observed_scientific_replay_required",
      lane: "independent_numerical_replication",
      process: { cwd: root },
      outputs,
      outputInventorySha256: sha256(JSON.stringify(outputs)),
    },
    independentReplicationArtifact: null,
    independentNumericalReplicationReady: false,
  } as unknown as Nhm2IndependentNumericalExecutionObservationV1;
  return { root, observation, outputs };
}

describe("NHM2 independent numerical content assessment", () => {
  it("rehashes opaque outputs but remains typed not-evaluable for all nine fields", async () => {
    const { observation } = await makeFixture();
    const result =
      await assessNhm2IndependentNumericalReplicationContent({
        executionObservation: observation,
      });

    expect(result.status).toBe("not_evaluable");
    expect(result.filesystemReadback.status).toBe("verified_opaque_outputs");
    expect(result.filesystemReadback.outputs).toHaveLength(3);
    expect(
      result.filesystemReadback.outputs.every(
        (entry) => entry.status === "verified_opaque_output",
      ),
    ).toBe(true);
    expect(result.requiredComparisonCount).toBe(9);
    expect(result.recomputedComparisonCount).toBe(0);
    expect(result.maximumRelativeLInf).toBeNull();
    expect(result.independentReplicationArtifact).toBeNull();
    expect(result.independentNumericalReplicationReady).toBe(false);
    expect(result.comparisons.map((entry) => entry.fieldId)).toEqual(
      NHM2_INDEPENDENT_NUMERICAL_REPLICATION_REQUIRED_FIELDS.map(
        (entry) => entry.fieldId,
      ),
    );
    expect(result.comparisons.every((entry) => entry.metricValue == null)).toBe(
      true,
    );
    expect(result.blockers).toContain(
      "external_kernel_manifest_declared_sidecar_closure_not_implemented",
    );
    expect(result.schemaAssessment.typedFieldArrayManifestContractRegistered).toBe(
      true,
    );
    expect(result.blockers).toContain(
      "all_nine_field_level_comparisons_not_recomputed",
    );
    expect(result.claimBoundary).toEqual({
      diagnosticOnly: true,
      opaqueExternalOutputReadbackIsNotScientificReplay: true,
      fieldLevelScientificReplayRequired: true,
      passingIndependentReplicationArtifactMayBeEmitted: false,
      theoryClosureEstablished: false,
      physicalViabilityEstablished: false,
      transportEstablished: false,
      propulsionEstablished: false,
      routeEtaEstablished: false,
      certifiedSpeedEstablished: false,
      empiricalValidationEstablished: false,
    });
  });

  it("enumerates exact array, component, sample-domain, and metric requirements", async () => {
    const { observation } = await makeFixture();
    const result =
      await assessNhm2IndependentNumericalReplicationContent({
        executionObservation: observation,
      });

    for (const [index, comparison] of result.comparisons.entries()) {
      const frozen = NHM2_INDEPENDENT_NUMERICAL_REPLICATION_REQUIRED_FIELDS[index];
      expect(comparison.componentOrder).toEqual(frozen.componentOrder);
      expect(comparison.arraySchemaRequirement).toMatchObject({
        dtype: "float64",
        encoding: "raw_ieee754",
        endianness: "little",
        rank: 2,
        storageOrder: "row-major",
        shape: ["sample_count", frozen.componentOrder.length],
        finiteValuesRequired: true,
        pathSha256AndSizeRequired: true,
        primaryAndIndependentShapeEqualityRequired: true,
      });
      expect(comparison.sampleDomainRequirement).toEqual({
        artifactIdContractVersionPathSha256AndSizeRequired: true,
        orderedRowIdentityRequired: true,
        coordinateTimeWorldlineOrObservableAxesRequired: true,
        sharedPrimaryIndependentDomainSha256Required: true,
        sampleCountMinimum:
          NHM2_PRIMARY_COMPARISON_PROJECTION_FIELD_POLICIES[index]
            .minimumSampleCount,
        refinementLevelsMinimum: 3,
        observedConvergenceOrderMinimum: 1,
        domainCoverageFractionRequired: 1,
      });
      expect(comparison.metricRequirement).toEqual({
        metric: "relative_L_inf",
        comparator: "lte",
        tolerance: 0.1,
        serverRecomputationRequired: true,
        denominatorAndZeroScalePolicyMustBeFrozen: true,
      });
      expect(comparison.blockers).toContain(
        `${comparison.fieldId}:independent_array_path_sha256_size_shape_component_binding_missing`,
      );
      expect(comparison.blockers).toContain(
        `${comparison.fieldId}:shared_sample_domain_manifest_missing`,
      );
    }
  });

  it("derives every primary source requirement from the canonical primitive projection policy", async () => {
    const { observation } = await makeFixture();
    const result =
      await assessNhm2IndependentNumericalReplicationContent({
        executionObservation: observation,
      });

    expect(
      Object.keys(NHM2_INDEPENDENT_NUMERICAL_PRIMARY_SOURCE_REQUIREMENTS),
    ).toEqual(
      NHM2_PRIMARY_COMPARISON_PROJECTION_FIELD_POLICIES.map(
        (fieldPolicy) => fieldPolicy.fieldId,
      ),
    );

    for (const [index, fieldPolicy] of
      NHM2_PRIMARY_COMPARISON_PROJECTION_FIELD_POLICIES.entries()) {
      const expectedSources = fieldPolicy.rawSources.map((source) => ({
        familyId: source.familyId,
        semanticRole: source.semanticRole,
        uses: [...source.uses],
      }));
      expect(
        NHM2_INDEPENDENT_NUMERICAL_PRIMARY_SOURCE_REQUIREMENTS[
          fieldPolicy.fieldId
        ],
      ).toEqual(expectedSources);
      expect(
        NHM2_INDEPENDENT_NUMERICAL_PRIMARY_SOURCE_REQUIREMENTS[
          fieldPolicy.fieldId
        ],
      ).toBe(fieldPolicy.rawSources);
      expect(result.comparisons[index].fieldId).toBe(fieldPolicy.fieldId);
      expect(result.comparisons[index].primaryRawSourceRequirement).toEqual(
        expectedSources,
      );
    }

    const assessorSemanticRoles = result.comparisons.flatMap((comparison) =>
      comparison.primaryRawSourceRequirement.map(
        (source) => source.semanticRole,
      ),
    );
    expect(assessorSemanticRoles).not.toContain("total_tensor_components");
    expect(assessorSemanticRoles).not.toContain(
      "renormalized_tensor_components",
    );
    expect(assessorSemanticRoles).not.toContain("divergence_components");
    expect(assessorSemanticRoles).not.toContain(
      "condition_optimum_objective_samples",
    );
    expect(assessorSemanticRoles).not.toContain("quadrature_integrand_samples");
    expect(assessorSemanticRoles).not.toContain("constraint_residual_components");
    expect(assessorSemanticRoles).not.toContain("maxwell_stress_components");
    expect(assessorSemanticRoles).not.toContain("stress_strain_components");
    expect(assessorSemanticRoles).not.toContain("observable_sample_vectors");
  });

  it("does not trust a producer-authored fake passing replication in the opaque inventory", async () => {
    const inventoryBytes = Buffer.from(
      JSON.stringify({
        contractVersion: "nhm2_independent_numerical_replication/v1",
        status: "pass",
        independentNumericalReplicationReady: true,
        comparison: {
          expectedFieldCount: 9,
          comparedFieldCount: 9,
          maximumMetricValue: 0,
        },
        claimBoundary: {
          physicalViability: true,
          transport: true,
          propulsion: true,
        },
      }),
      "utf8",
    );
    const { observation } = await makeFixture({ inventoryBytes });
    (observation as unknown as Record<string, unknown>)[
      "independentReplicationArtifact"
    ] = { status: "pass" };

    const result =
      await assessNhm2IndependentNumericalReplicationContent({
        executionObservation: observation,
      });

    expect(result.filesystemReadback.status).toBe("verified_opaque_outputs");
    expect(result.status).toBe("not_evaluable");
    expect(result.independentReplicationArtifact).toBeNull();
    expect(result.recomputedComparisonCount).toBe(0);
    expect(result.claimBoundary.passingIndependentReplicationArtifactMayBeEmitted).toBe(
      false,
    );
    expect(result.claimBoundary.physicalViabilityEstablished).toBe(false);
    expect(JSON.stringify(result)).not.toContain(
      "nhm2_independent_numerical_replication/v1",
    );
  });

  it("detects output mutation during the later filesystem readback", async () => {
    const { root, observation, outputs } = await makeFixture();
    const bundle = outputs.find(
      (entry) => entry.role === "independent_replay_bundle",
    )!;
    await fs.writeFile(
      path.join(root, ...bundle.relativePath.split("/")),
      Buffer.from([9, 9, 9, 9]),
    );

    const result =
      await assessNhm2IndependentNumericalReplicationContent({
        executionObservation: observation,
      });

    expect(result.filesystemReadback.status).toBe("not_verified");
    expect(result.blockers).toContain(
      "output_sha256_mismatch:independent_replay_bundle",
    );
    expect(result.independentReplicationArtifact).toBeNull();
  });

  it("rejects path traversal before reading any producer-selected path", async () => {
    const { observation } = await makeFixture();
    const kernel = observation.kernelObservation!;
    kernel.outputs[0] = {
      ...kernel.outputs[0],
      relativePath: "../outside.bin",
    };

    const result =
      await assessNhm2IndependentNumericalReplicationContent({
        executionObservation: observation,
      });

    expect(result.filesystemReadback.status).toBe("not_verified");
    expect(result.blockers).toContain(
      "output_path_invalid:independent_replay_bundle",
    );
    expect(result.recomputedComparisonCount).toBe(0);
  });

  it("returns not-evaluable when no successful external execution exists", async () => {
    const observation = {
      artifactId: "nhm2.independent_numerical_execution_observation",
      contractVersion: NHM2_INDEPENDENT_NUMERICAL_EXECUTION_OBSERVATION_VERSION,
      generatedAt: "2026-07-20T12:00:00.000Z",
      status: "not_ready",
      candidate: {
        manifestPath: "artifacts/candidate.json",
        manifestSha256: null,
        candidateId: null,
      },
      plan: {
        requestId: null,
        runId: null,
        receiptId: null,
        runtimeId: null,
        solverId: null,
        implementationId: null,
        independenceGroup: null,
      },
      kernelObservation: null,
      independentReplicationArtifact: null,
      independentNumericalReplicationReady: false,
    } as unknown as Nhm2IndependentNumericalExecutionObservationV1;

    const result =
      await assessNhm2IndependentNumericalReplicationContent({
        executionObservation: observation,
      });

    expect(result.status).toBe("not_evaluable");
    expect(result.filesystemReadback.status).toBe("not_verified");
    expect(result.filesystemReadback.outputs).toEqual([]);
    expect(result.blockers).toContain(
      "successful_kernel_execution_observation_missing",
    );
    expect(result.independentReplicationArtifact).toBeNull();
  });

  it("fails closed on an inexact opaque output role set", async () => {
    const { observation } = await makeFixture();
    observation.kernelObservation!.outputs[0] = {
      ...observation.kernelObservation!.outputs[0],
      role: "independent_field_array_manifest",
    };

    const result =
      await assessNhm2IndependentNumericalReplicationContent({
        executionObservation: observation,
      });

    expect(result.filesystemReadback.status).toBe("not_verified");
    expect(result.blockers).toContain("opaque_output_role_set_not_exact");
    expect(result.schemaAssessment.typedFieldArrayManifestRoleObserved).toBe(
      true,
    );
    expect(result.independentReplicationArtifact).toBeNull();
  });
});
