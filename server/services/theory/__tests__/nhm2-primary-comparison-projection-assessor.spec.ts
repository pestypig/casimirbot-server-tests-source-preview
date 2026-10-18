import { describe, expect, it, vi } from "vitest";

import {
  NHM2_PRIMARY_COMPARISON_ORDERED_DOMAIN_ARTIFACT_ID,
  NHM2_PRIMARY_COMPARISON_ORDERED_DOMAIN_CONTRACT_VERSION,
  NHM2_PRIMARY_COMPARISON_PROJECTION_ARRAY_ENCODING,
  NHM2_PRIMARY_COMPARISON_PROJECTION_ARRAY_ENDIANNESS,
  NHM2_PRIMARY_COMPARISON_PROJECTION_ARRAY_STORAGE_ORDER,
  NHM2_PRIMARY_COMPARISON_PROJECTION_DOMAIN_ORDERING,
  NHM2_PRIMARY_COMPARISON_PROJECTION_FIELD_POLICIES,
  NHM2_PRIMARY_COMPARISON_PROJECTION_FREEZE_POLICY_ID,
  NHM2_PRIMARY_COMPARISON_PROJECTION_FREEZE_POLICY_VERSION,
  NHM2_PRIMARY_COMPARISON_PROJECTION_MANIFEST_ARTIFACT_ID,
  NHM2_PRIMARY_COMPARISON_PROJECTION_MANIFEST_CONTRACT_VERSION,
  NHM2_PRIMARY_COMPARISON_PROJECTION_POLICY_ARTIFACT_ID,
  NHM2_PRIMARY_COMPARISON_PROJECTION_POLICY_CONTRACT_VERSION,
  NHM2_PRIMARY_COMPARISON_PROJECTION_POLICY,
  NHM2_PRIMARY_COMPARISON_PROJECTION_POLICY_SHA256,
  computeNhm2PrimaryComparisonOrderedRowsSha256,
  computeNhm2PrimaryComparisonProjectionPolicySha256,
  nhm2PrimaryComparisonOrderedSampleDomainViolations,
  nhm2PrimaryComparisonProjectionManifestViolations,
  type Nhm2PrimaryComparisonOrderedSampleDomainV1,
  type Nhm2PrimaryComparisonProjectionManifestV1,
} from "../../../../shared/contracts/nhm2-primary-comparison-projection.v1";
import {
  NHM2_PRIMARY_COMPARISON_PROJECTION_FREEZE_ADMISSION_ARTIFACT_ID,
  NHM2_PRIMARY_COMPARISON_PROJECTION_FREEZE_ADMISSION_CONTRACT_VERSION,
  assessNhm2PrimaryComparisonProjection,
  computeNhm2PrimaryRawVerifiedFileInventorySha256,
  computeNhm2PrimaryComparisonProjectionManifestSemanticSha256,
  createNhm2PrimaryComparisonProjectionAssessor,
  isNhm2PrimaryComparisonProjectionAssessmentV1,
} from "../nhm2-primary-comparison-projection-assessor";
import type { Nhm2PrimaryRawOutputFilesystemVerification } from "../nhm2-primary-raw-output-filesystem-verifier";

const digest = (character: string): string => character.repeat(64);

const verifiedRawFixture = (): Extract<
  Nhm2PrimaryRawOutputFilesystemVerification,
  { verified: true }
> =>
  ({
    verified: true,
    violations: [],
    runRootRealPath: "/verified-primary-run",
    manifestPath: "/verified-primary-run/primary-raw-output-manifest.v1.json",
    manifestSha256: digest("6"),
    manifest: {
      inputClosure: { closureSha256: digest("8") },
    },
    files: [],
  }) as unknown as Extract<
    Nhm2PrimaryRawOutputFilesystemVerification,
    { verified: true }
  >;

const manifestFixture = (): Nhm2PrimaryComparisonProjectionManifestV1 => ({
  artifactId: NHM2_PRIMARY_COMPARISON_PROJECTION_MANIFEST_ARTIFACT_ID,
  contractVersion: NHM2_PRIMARY_COMPARISON_PROJECTION_MANIFEST_CONTRACT_VERSION,
  generatedAt: "2026-07-20T12:00:02.000Z",
  identity: {
    candidateId: "nhm2-candidate-a",
    laneId: "nhm2_shift_lapse",
    selectedProfileId: "alpha-0.7",
    chartId: "same-chart-v1",
    primaryRequestId: "primary-request-a",
    primaryRunId: "primary-run-a",
    primaryReceiptId: "primary-receipt-a",
    primaryRuntimeId: "warp.full_solve.campaign",
    primarySolverId: "primary-solver-a",
    primarySourceCommitSha: "1".repeat(40),
    candidateManifest: { inputId: "candidate_manifest", sha256: digest("2") },
    chartDefinition: { inputId: "chart_definition", sha256: digest("3") },
    units: { inputId: "units_definition", sha256: digest("4") },
    normalization: { inputId: "normalization_definition", sha256: digest("5") },
  },
  rawPackage: {
    artifactId: "nhm2.primary_raw_output_manifest",
    contractVersion: "nhm2_primary_raw_output_manifest/v1",
    manifestRelativePath: "primary-raw-output-manifest.v1.json",
    manifestSha256: digest("6"),
    contentPolicySha256: digest("7"),
    inputClosureSha256: digest("8"),
    verifiedFileInventorySha256: digest("9"),
  },
  projectionPolicy: {
    artifactId: NHM2_PRIMARY_COMPARISON_PROJECTION_POLICY_ARTIFACT_ID,
    contractVersion: NHM2_PRIMARY_COMPARISON_PROJECTION_POLICY_CONTRACT_VERSION,
    semanticSha256: NHM2_PRIMARY_COMPARISON_PROJECTION_POLICY_SHA256,
  },
  freeze: {
    policyId: NHM2_PRIMARY_COMPARISON_PROJECTION_FREEZE_POLICY_ID,
    policyVersion: NHM2_PRIMARY_COMPARISON_PROJECTION_FREEZE_POLICY_VERSION,
    registrationId: "projection-freeze-a",
    independentRequestId: "independent-request-a",
    independentRunId: "independent-run-a",
    independentPlanSha256: digest("a"),
    projectionCompletedAt: "2026-07-20T12:00:02.000Z",
    frozenBeforeIndependentRun: true,
  },
  fields: NHM2_PRIMARY_COMPARISON_PROJECTION_FIELD_POLICIES.map(
    (policy, index) => {
      const componentCount = policy.componentOrder.length;
      const sampleCount = policy.minimumSampleCount;
      const basename = `field-${index + 1}`;
      const array = (suffix: string, hashCharacter: string) => ({
        path: `${basename}/${suffix}.f64le`,
        sha256: digest(hashCharacter),
        sizeBytes: sampleCount * componentCount * 8,
        dtype: "float64" as const,
        encoding: NHM2_PRIMARY_COMPARISON_PROJECTION_ARRAY_ENCODING,
        endianness: NHM2_PRIMARY_COMPARISON_PROJECTION_ARRAY_ENDIANNESS,
        shape: [sampleCount, componentCount] as [number, number],
        storageOrder: NHM2_PRIMARY_COMPARISON_PROJECTION_ARRAY_STORAGE_ORDER,
        componentOrder: [...policy.componentOrder],
        componentUnits: [...policy.componentUnits],
      });
      return {
        ordinal: index + 1,
        fieldId: policy.fieldId,
        componentOrder: [...policy.componentOrder],
        componentUnits: [...policy.componentUnits],
        rawSources: policy.rawSources.map((source, sourceIndex) => ({
          familyId: source.familyId,
          semanticRole: source.semanticRole,
          fileId: `${source.familyId}.${source.semanticRole}`,
          path: `raw/${index}-${sourceIndex}.bin`,
          sha256: digest(((index + sourceIndex) % 10).toString(16)),
          sizeBytes: 512,
        })),
        projectionOperator: {
          operatorId: policy.projectionOperatorId,
          derivationId: policy.projectionDerivationId,
        },
        output: array("primary", ((index + 1) % 10).toString(16)),
        orderedDomainOperator: {
          operatorId: policy.orderedDomainOperatorId,
          rowIdentitySchemaId: policy.orderedDomainRowIdentitySchemaId,
        },
        orderedDomain: {
          artifactId: NHM2_PRIMARY_COMPARISON_ORDERED_DOMAIN_ARTIFACT_ID,
          contractVersion:
            NHM2_PRIMARY_COMPARISON_ORDERED_DOMAIN_CONTRACT_VERSION,
          path: `${basename}/ordered-domain.v1.json`,
          sha256: digest(((index + 2) % 10).toString(16)),
          sizeBytes: 1024,
          rowCount: sampleCount,
          orderedRowsSha256: digest(((index + 3) % 10).toString(16)),
        },
        uncertainty: {
          operatorId: policy.uncertaintyOperatorId,
          derivationId: policy.uncertaintyDerivationId,
          coverage: policy.uncertaintyCoverage,
          confidenceLevelAtLeast: 0.95 as const,
          output: array("uncertainty", ((index + 4) % 10).toString(16)),
        },
      };
    },
  ),
  claimBoundary: {
    diagnosticComparisonInputOnly: true,
    independentComparisonStillRequired: true,
    empiricalReceiptsStillRequired: true,
    theoryClosureEstablished: false,
    physicalViabilityEstablished: false,
    transportEstablished: false,
    propulsionEstablished: false,
    routeEtaEstablished: false,
    certifiedSpeedEstablished: false,
  },
});

const domainFixture = (): Nhm2PrimaryComparisonOrderedSampleDomainV1 => {
  const policy = NHM2_PRIMARY_COMPARISON_PROJECTION_FIELD_POLICIES[0];
  const semantic = {
    artifactId: NHM2_PRIMARY_COMPARISON_ORDERED_DOMAIN_ARTIFACT_ID,
    contractVersion: NHM2_PRIMARY_COMPARISON_ORDERED_DOMAIN_CONTRACT_VERSION,
    fieldId: policy.fieldId,
    ordering: NHM2_PRIMARY_COMPARISON_PROJECTION_DOMAIN_ORDERING,
    rowIdentitySchemaId: policy.orderedDomainRowIdentitySchemaId,
    rowCount: policy.minimumSampleCount,
    rows: Array.from({ length: policy.minimumSampleCount }, (_, ordinal) => ({
      ordinal,
      rowId: `sample-${ordinal}`,
      axes: [
        {
          axisId: "sample_index",
          valueKind: "int64" as const,
          value: ordinal,
          unit: null,
        },
      ],
    })),
  };
  return {
    ...semantic,
    orderedRowsSha256: computeNhm2PrimaryComparisonOrderedRowsSha256(semantic),
  };
};

describe("NHM2 primary comparison projection v1", () => {
  it("deep-freezes the complete field and policy graphs before pinning the semantic hash", () => {
    const pinned = NHM2_PRIMARY_COMPARISON_PROJECTION_POLICY_SHA256;
    const firstField = NHM2_PRIMARY_COMPARISON_PROJECTION_FIELD_POLICIES[0];

    expect(
      Object.isFrozen(NHM2_PRIMARY_COMPARISON_PROJECTION_FIELD_POLICIES),
    ).toBe(true);
    expect(Object.isFrozen(firstField)).toBe(true);
    expect(Object.isFrozen(firstField.componentOrder)).toBe(true);
    expect(Object.isFrozen(firstField.rawSources)).toBe(true);
    expect(Object.isFrozen(firstField.rawSources[0])).toBe(true);
    expect(Object.isFrozen(firstField.rawSources[0].uses)).toBe(true);
    expect(Object.isFrozen(NHM2_PRIMARY_COMPARISON_PROJECTION_POLICY)).toBe(
      true,
    );
    expect(
      Object.isFrozen(
        NHM2_PRIMARY_COMPARISON_PROJECTION_POLICY.outputArrayFormat,
      ),
    ).toBe(true);
    expect(
      Object.isFrozen(NHM2_PRIMARY_COMPARISON_PROJECTION_POLICY.orderedDomain),
    ).toBe(true);
    expect(
      Object.isFrozen(NHM2_PRIMARY_COMPARISON_PROJECTION_POLICY.claimBoundary),
    ).toBe(true);

    expect(Reflect.set(firstField, "minimumSampleCount", 1)).toBe(false);
    expect(Reflect.set(firstField.componentOrder, "0", "mutated")).toBe(false);
    expect(
      Reflect.set(
        NHM2_PRIMARY_COMPARISON_PROJECTION_POLICY.claimBoundary,
        "physicalViabilityAllowed",
        true,
      ),
    ).toBe(false);
    expect(computeNhm2PrimaryComparisonProjectionPolicySha256()).toBe(pinned);
  });

  it("uses raw-domain-specific minima without permitting synthetic row duplication", () => {
    expect(
      NHM2_PRIMARY_COMPARISON_PROJECTION_FIELD_POLICIES.map((field) => [
        field.fieldId,
        field.minimumSampleCount,
      ]),
    ).toEqual([
      ["full_apparatus_source_tensor.full_tensor", 64],
      ["semiclassical_state.renormalized_full_tensor", 64],
      ["covariant_conservation.divergence_four_vector", 64],
      ["continuous_observer_optimizer.minimum_energy_density", 64],
      ["worldline_qei.sampled_bound_and_margin", 24],
      [
        "dynamic_backreaction_stability_causality.constraint_stability_causality",
        16,
      ],
      [
        "finite_temperature_finite_geometry_maxwell_stress.surface_traction_and_gradient",
        64,
      ],
      [
        "mechanical_support_control_margin.stress_displacement_control_margins",
        64,
      ],
      ["prediction_falsifier_freeze.pre_registered_observables", 6],
    ]);
    expect(
      NHM2_PRIMARY_COMPARISON_PROJECTION_POLICY.orderedDomain
        .syntheticRowDuplicationForbidden,
    ).toBe(true);
    expect(
      NHM2_PRIMARY_COMPARISON_PROJECTION_POLICY.orderedDomain
        .uniqueRowIdsRequired,
    ).toBe(true);
  });

  it("freezes the exact nine comparison fields and primitive derivation metadata", () => {
    const manifest = manifestFixture();
    expect(nhm2PrimaryComparisonProjectionManifestViolations(manifest)).toEqual(
      [],
    );
    expect(manifest.fields.map((field) => field.fieldId)).toEqual(
      NHM2_PRIMARY_COMPARISON_PROJECTION_FIELD_POLICIES.map(
        (field) => field.fieldId,
      ),
    );
  });

  it("rejects field, component, primitive lineage, and derivation substitution", () => {
    const reordered = manifestFixture();
    [reordered.fields[0], reordered.fields[1]] = [
      reordered.fields[1],
      reordered.fields[0],
    ];
    expect(
      nhm2PrimaryComparisonProjectionManifestViolations(reordered),
    ).toEqual(expect.arrayContaining(["field_0_field_id_invalid"]));

    const component = manifestFixture();
    component.fields[0].componentOrder.reverse();
    expect(
      nhm2PrimaryComparisonProjectionManifestViolations(component),
    ).toEqual(expect.arrayContaining(["field_0_component_order_invalid"]));

    const source = manifestFixture();
    source.fields[0].rawSources[0].semanticRole = "total_tensor_components";
    expect(nhm2PrimaryComparisonProjectionManifestViolations(source)).toEqual(
      expect.arrayContaining(["field_0_raw_source_order_invalid"]),
    );

    const operator = manifestFixture();
    operator.fields[0].projectionOperator.derivationId =
      "copy_declared_total/v1";
    expect(nhm2PrimaryComparisonProjectionManifestViolations(operator)).toEqual(
      expect.arrayContaining(["field_0_projection_operator_invalid"]),
    );
  });

  it("rejects malformed float64, domain, uncertainty, raw closure, and claim metadata", () => {
    const array = manifestFixture();
    array.fields[0].output.storageOrder = "column-major" as "row-major";
    array.fields[0].output.sizeBytes -= 8;
    expect(nhm2PrimaryComparisonProjectionManifestViolations(array)).toEqual(
      expect.arrayContaining([
        "field_0_output_representation_invalid",
        "field_0_output_shape_size_mismatch",
      ]),
    );

    const domain = manifestFixture();
    domain.fields[0].orderedDomain.rowCount = 63;
    expect(nhm2PrimaryComparisonProjectionManifestViolations(domain)).toEqual(
      expect.arrayContaining(["field_0_ordered_domain_binding_invalid"]),
    );

    const uncertainty = manifestFixture();
    uncertainty.fields[0].uncertainty.confidenceLevelAtLeast = 0.9 as 0.95;
    expect(
      nhm2PrimaryComparisonProjectionManifestViolations(uncertainty),
    ).toEqual(
      expect.arrayContaining(["field_0_uncertainty_derivation_invalid"]),
    );

    const closure = manifestFixture();
    closure.rawPackage.inputClosureSha256 = "caller-asserted";
    expect(nhm2PrimaryComparisonProjectionManifestViolations(closure)).toEqual(
      expect.arrayContaining(["raw_package_input_closure_sha256_invalid"]),
    );

    const claim = manifestFixture();
    claim.claimBoundary.physicalViabilityEstablished = true as false;
    expect(nhm2PrimaryComparisonProjectionManifestViolations(claim)).toEqual(
      expect.arrayContaining(["claim_boundary_invalid"]),
    );
  });

  it("hashes ordered rows semantically and rejects row reordering, duplication, or nonfinite axes", () => {
    const domain = domainFixture();
    const policy = NHM2_PRIMARY_COMPARISON_PROJECTION_FIELD_POLICIES[0];
    const expected = {
      fieldId: policy.fieldId,
      rowIdentitySchemaId: policy.orderedDomainRowIdentitySchemaId,
      minimumRowCount: policy.minimumSampleCount,
    };
    expect(
      nhm2PrimaryComparisonOrderedSampleDomainViolations(domain, expected),
    ).toEqual([]);

    const duplicate = structuredClone(domain);
    duplicate.rows[1].rowId = duplicate.rows[0].rowId;
    expect(
      nhm2PrimaryComparisonOrderedSampleDomainViolations(duplicate, expected),
    ).toEqual(
      expect.arrayContaining([
        "domain_row_id_invalid:1",
        "domain_ordered_rows_sha256_mismatch",
      ]),
    );

    const reordered = structuredClone(domain);
    [reordered.rows[0], reordered.rows[1]] = [
      reordered.rows[1],
      reordered.rows[0],
    ];
    expect(
      nhm2PrimaryComparisonOrderedSampleDomainViolations(reordered, expected),
    ).toEqual(expect.arrayContaining(["domain_row_ordinal_invalid:0"]));

    const nonfinite = structuredClone(domain);
    nonfinite.rows[0].axes[0] = {
      axisId: "coordinate",
      valueKind: "float64",
      value: Number.POSITIVE_INFINITY,
      unit: "m",
    };
    expect(
      nhm2PrimaryComparisonOrderedSampleDomainViolations(nonfinite, expected),
    ).toEqual(expect.arrayContaining(["domain_axis_value_invalid:0:0"]));
  });

  it("remains explicitly not-ready with no actual verified raw run and no server replay", async () => {
    const assessment = await assessNhm2PrimaryComparisonProjection({
      manifest: manifestFixture(),
      rawVerification: null,
    });
    expect(assessment.status).toBe("not_ready");
    expect(assessment.primaryComparisonProjectionReady).toBe(false);
    expect(assessment.fields).toHaveLength(9);
    expect(
      assessment.fields.every((field) => field.status === "not_ready"),
    ).toBe(true);
    expect(assessment.blockers).toEqual(
      expect.arrayContaining([
        "primary_raw_filesystem_verification_missing_or_failed",
        "server_owned_freeze_admission_missing",
        "projection_output_filesystem_readback_not_implemented",
        "ordered_domain_filesystem_readback_not_implemented",
        "server_owned_projection_operator_replay_not_implemented",
      ]),
    );
    expect(assessment.claimBoundary).toMatchObject({
      theoryClosureEstablished: false,
      physicalViabilityEstablished: false,
      transportEstablished: false,
      propulsionEstablished: false,
      routeEtaEstablished: false,
      certifiedSpeedEstablished: false,
    });
  });

  it("does not turn a missing manifest into a vacuous ready publication", async () => {
    const assessment = await assessNhm2PrimaryComparisonProjection({
      manifest: null,
      rawVerification: null,
    });
    expect(assessment.primaryComparisonProjectionReady).toBe(false);
    expect(assessment.blockers).toEqual(
      expect.arrayContaining([
        "projection_manifest_missing",
        "primary_raw_filesystem_verification_not_bound",
        "server_owned_freeze_admission_not_assessed",
      ]),
    );
    expect(assessment.structuralAssessment).toMatchObject({
      exactNineFields: false,
      exactComponentOrderAndUnits: false,
      exactPrimitiveSourceLineage: false,
      exactProjectionAndUncertaintyDerivations: false,
      float64OutputMetadataBound: false,
      orderedDomainMetadataBound: false,
      identityBoundToRawRun: false,
      freezeAdmissionBound: false,
    });
    expect(
      assessment.fields.every(
        (field) =>
          field.rawSourceBindingsMatchVerifiedPackage === false &&
          field.outputMetadataStructurallyValid === false &&
          field.orderedDomainMetadataStructurallyValid === false &&
          field.uncertaintyMetadataStructurallyValid === false,
      ),
    ).toBe(true);
  });

  it("records a verified raw observation without claiming it is bound to a missing projection manifest", async () => {
    const rawVerification = verifiedRawFixture();
    const assessment = await assessNhm2PrimaryComparisonProjection({
      manifest: null,
      rawVerification,
    });

    expect(assessment.source).toEqual({
      manifestArtifactId: null,
      manifestContractVersion: null,
      manifestSha256: null,
      rawFilesystemVerificationObserved: true,
      rawFilesystemVerificationBoundToProjectionManifest: false,
      rawManifestSha256: digest("6"),
      rawInputClosureSha256: digest("8"),
      rawVerifiedFileInventorySha256:
        computeNhm2PrimaryRawVerifiedFileInventorySha256(rawVerification),
    });
    expect(assessment.primaryComparisonProjectionReady).toBe(false);
    expect(assessment.blockers).toEqual(
      expect.arrayContaining([
        "projection_manifest_missing",
        "primary_raw_filesystem_verification_not_bound",
        "server_owned_projection_operator_replay_not_implemented",
      ]),
    );
    expect(isNhm2PrimaryComparisonProjectionAssessmentV1(assessment)).toBe(
      true,
    );
  });

  it("gates raw and freeze processing after a structural violation", async () => {
    const invalidManifest = manifestFixture();
    invalidManifest.claimBoundary.theoryClosureEstablished = true as false;
    let rawVerificationRead = false;
    const hostileRawVerification = new Proxy(
      {},
      {
        get: () => {
          rawVerificationRead = true;
          throw new Error("raw verification must not be read");
        },
      },
    );
    const loadFreezeAdmission = vi.fn(async () => null);
    const assessor = createNhm2PrimaryComparisonProjectionAssessor({
      loadFreezeAdmission,
    });

    const assessment = await assessor({
      manifest: invalidManifest,
      rawVerification: hostileRawVerification as never,
    });

    expect(rawVerificationRead).toBe(false);
    expect(loadFreezeAdmission).not.toHaveBeenCalled();
    expect(assessment.blockers).toEqual(
      expect.arrayContaining([
        "claim_boundary_invalid",
        "primary_raw_filesystem_verification_not_bound",
        "server_owned_freeze_admission_not_assessed",
      ]),
    );
    expect(
      Object.values(assessment.structuralAssessment).every(
        (value) => value === false,
      ),
    ).toBe(true);
  });

  it("returns a fail-closed assessment for malformed or throwing manifest values", async () => {
    const loadFreezeAdmission = vi.fn(async () => null);
    const assessor = createNhm2PrimaryComparisonProjectionAssessor({
      loadFreezeAdmission,
    });
    const throwingManifest = new Proxy(
      {},
      {
        get: () => {
          throw new Error("hostile manifest getter");
        },
      },
    );

    await expect(
      assessor({ manifest: throwingManifest, rawVerification: null }),
    ).resolves.toMatchObject({
      status: "not_ready",
      primaryComparisonProjectionReady: false,
      structuralAssessment: {
        exactNineFields: false,
        exactComponentOrderAndUnits: false,
        exactPrimitiveSourceLineage: false,
        exactProjectionAndUncertaintyDerivations: false,
        float64OutputMetadataBound: false,
        orderedDomainMetadataBound: false,
        identityBoundToRawRun: false,
        freezeAdmissionBound: false,
        outputFilesystemReadbackPerformed: false,
        orderedDomainFilesystemReadbackPerformed: false,
        serverOwnedProjectionReplayPerformed: false,
      },
    });
    expect(loadFreezeAdmission).not.toHaveBeenCalled();
  });

  it("binds freeze admission only when the isolated freeze check has zero violations", async () => {
    const manifest = manifestFixture();
    const admission = {
      artifactId:
        NHM2_PRIMARY_COMPARISON_PROJECTION_FREEZE_ADMISSION_ARTIFACT_ID,
      contractVersion:
        NHM2_PRIMARY_COMPARISON_PROJECTION_FREEZE_ADMISSION_CONTRACT_VERSION,
      registrationId: manifest.freeze.registrationId,
      candidateId: manifest.identity.candidateId,
      primaryRunId: manifest.identity.primaryRunId,
      independentRequestId: manifest.freeze.independentRequestId,
      independentRunId: manifest.freeze.independentRunId,
      independentPlanSha256: manifest.freeze.independentPlanSha256,
      projectionManifestSha256:
        computeNhm2PrimaryComparisonProjectionManifestSemanticSha256(manifest),
      registeredAt: "2026-07-20T12:00:03.000Z",
      independentExecutionNotBefore: "2026-07-20T12:00:04.000Z",
      authority: "server_owned_pre_spawn_store" as const,
    };
    const accepted = await createNhm2PrimaryComparisonProjectionAssessor({
      loadFreezeAdmission: async () => admission,
    })({ manifest, rawVerification: null });
    expect(accepted.structuralAssessment.freezeAdmissionBound).toBe(true);

    const rejected = await createNhm2PrimaryComparisonProjectionAssessor({
      loadFreezeAdmission: async () => ({
        ...admission,
        authority: "producer_manifest" as never,
      }),
    })({ manifest, rawVerification: null });
    expect(rejected.structuralAssessment.freezeAdmissionBound).toBe(false);
    expect(rejected.blockers).toContain(
      "server_owned_freeze_admission_contract_invalid",
    );
  });

  it("keeps the assessment type guard total and checks every claim-boundary literal", async () => {
    const assessment = await assessNhm2PrimaryComparisonProjection({
      manifest: null,
      rawVerification: null,
    });
    expect(isNhm2PrimaryComparisonProjectionAssessmentV1(assessment)).toBe(
      true,
    );

    const malformedValues: unknown[] = [
      null,
      {},
      { ...assessment, source: null },
      { ...assessment, structuralAssessment: null },
      { ...assessment, fields: [null] },
      { ...assessment, claimBoundary: null },
      new Proxy(
        {},
        {
          get: () => {
            throw new Error("hostile assessment getter");
          },
        },
      ),
    ];
    for (const malformed of malformedValues) {
      expect(() =>
        isNhm2PrimaryComparisonProjectionAssessmentV1(malformed),
      ).not.toThrow();
      expect(isNhm2PrimaryComparisonProjectionAssessmentV1(malformed)).toBe(
        false,
      );
    }

    const trueClaims = [
      "diagnosticComparisonInputOnly",
      "metadataAssessmentIsNotArrayReplay",
      "independentComparisonStillRequired",
      "empiricalReceiptsStillRequired",
    ] as const;
    for (const claim of trueClaims) {
      const mutated = structuredClone(assessment);
      (mutated.claimBoundary as unknown as Record<string, unknown>)[claim] =
        false;
      expect(isNhm2PrimaryComparisonProjectionAssessmentV1(mutated)).toBe(
        false,
      );
    }
    const falseClaims = [
      "theoryClosureEstablished",
      "physicalViabilityEstablished",
      "transportEstablished",
      "propulsionEstablished",
      "routeEtaEstablished",
      "certifiedSpeedEstablished",
    ] as const;
    for (const claim of falseClaims) {
      const mutated = structuredClone(assessment);
      (mutated.claimBoundary as unknown as Record<string, unknown>)[claim] =
        true;
      expect(isNhm2PrimaryComparisonProjectionAssessmentV1(mutated)).toBe(
        false,
      );
    }
  });
});
