import { describe, expect, it } from "vitest";
import {
  CASIMIR_SPEC_BENCHMARK_SEALED_POPULATION_RECEIPT_SCHEMA_VERSION,
  unsafeSealCasimirSpecBenchmarkPopulationReceiptV1,
} from "../../../../shared/contracts/casimir-spec-benchmark-promotion-gate.v1";
import { CASIMIR_SPEC_BENCHMARK_PAIRED_EPISODES_SCHEMA_VERSION } from "../../../../shared/contracts/casimir-spec-benchmark-statistics.v1";
import { assessServerTrustedCasimirSpecBenchmarkPromotionV1 } from "../casimir-spec-benchmark-promotion-service";

describe("server-trusted Casimir Spec benchmark promotion", () => {
  it("cannot promote a structurally sealed receipt absent from the trust registry", async () => {
    const receipt = await unsafeSealCasimirSpecBenchmarkPopulationReceiptV1({
      schemaVersion:
        CASIMIR_SPEC_BENCHMARK_SEALED_POPULATION_RECEIPT_SCHEMA_VERSION,
      receiptId: "sealed-population:not-externally-authenticated",
      benchmarkId: "casimir-spec-benchmark-v1",
      contentClass: "benchmark",
      publicFreezeSha256: "a".repeat(64),
      hiddenBundleCommitmentSha256: "b".repeat(64),
      revealedBundleArtifactSha256: "c".repeat(64),
      runManifestArtifactSha256: "d".repeat(64),
      pairedEpisodesArtifactSha256: "e".repeat(64),
      safetyGroupOutcomesArtifactSha256: "f".repeat(64),
      counts: {
        cellCount: 66,
        problemGroupCount: 990,
        replicateCountPerProblemGroup: 3,
        adjacentPairCount: 2970,
        sealedArmResponseCount: 5940,
        initialRatingCount: 11880,
        safetyCriticalProblemGroupCount: 528,
      },
      populationValidation: "passed",
      scheduleValidation: "passed",
      pairAdjacencyValidation: "passed",
      responseAndUsageManifestValidation: "passed",
      ratingAndAdjudicationValidation: "passed",
      raterQualificationReceiptAuthentication:
        "verified_by_server_trust_registry",
      externalTimestampReceiptAuthentication:
        "verified_by_server_trust_registry",
      isolatedSinkReceiptAuthentication: "verified_by_server_trust_registry",
      custodianIndependence: "verified",
      validatorImplementationId: "external-verifier",
      validatorRevisionSha256: "1".repeat(64),
      trustRegistrySha256: "2".repeat(64),
      verifiedAt: "2026-07-25T21:00:00.000Z",
    });

    const result = await assessServerTrustedCasimirSpecBenchmarkPromotionV1({
      assessedAt: "2026-07-25T21:01:00.000Z",
      sealedPopulationReceipt: receipt,
      pairedEpisodes: {
        schemaVersion: CASIMIR_SPEC_BENCHMARK_PAIRED_EPISODES_SCHEMA_VERSION,
        arms: { baseline: "baseline", candidate: "candidate" },
        expectedReplicateIds: ["1", "2", "3"],
        episodes: [],
      },
      safetyGroupOutcomes: [],
      bootstrapSeedMaterial: "3".repeat(64),
      hardGateRegressions: [],
      detectedTamperFixtureFamilies: [],
      pdeLanyonEffectReportedSeparately: false,
      replayArtifactsReproducible: false,
    });

    expect(result.status).toBe("promotion_blocked");
    expect(result.checks.sealedPopulationAuthenticated).toBe(false);
    expect(result.blockers.map((blocker) => blocker.code)).toContain(
      "sealed_population_authentication_missing",
    );
    expect(result.claimBoundary.scientificAuthority).toBe(false);
  });
});
