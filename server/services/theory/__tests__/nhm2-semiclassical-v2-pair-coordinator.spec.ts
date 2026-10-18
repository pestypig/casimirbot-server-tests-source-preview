import { describe, expect, it, vi } from "vitest";

import {
  createNhm2SemiclassicalV2PairCoordinator,
  NHM2_SEMICLASSICAL_V2_PAIR_COORDINATOR_BLOCKERS,
  NHM2_SEMICLASSICAL_V2_PAIR_COORDINATOR_CLAIM_LOCKS,
} from "../nhm2-semiclassical-v2-pair-coordinator";
import {
  createTestOnlyNhm2SemiclassicalV2PairExecutionCatalog,
  NHM2_SEMICLASSICAL_V2_PAIR_EXECUTION_CATALOG_CONTRACT_VERSION,
  type Nhm2SemiclassicalV2PairExecutionCatalogResolverV1,
  type Nhm2SemiclassicalV2PairTestCatalogRegistrationV1,
} from "../nhm2-semiclassical-v2-pair-execution-catalog";

const request = {
  opaquePairEnrollmentId: "pair-enrollment.opaque-1",
  scientificPresealReceiptId: "preseal-receipt.opaque-1",
  scientificPresealArtifactId: "preseal-artifact.opaque-1",
} as const;

const expectAllLocksClosed = (locks: Record<string, boolean>): void => {
  expect(Object.keys(locks)).toEqual(
    Object.keys(NHM2_SEMICLASSICAL_V2_PAIR_COORDINATOR_CLAIM_LOCKS),
  );
  expect(Object.values(locks).every((value) => value === false)).toBe(true);
};

describe("NHM2 semiclassical-v2 pair coordinator", () => {
  it("fails closed by default because no production OS pair is enrolled", async () => {
    const result =
      await createNhm2SemiclassicalV2PairCoordinator().run(request);
    expect(result.status).toBe("blocked");
    expect(result.stoppedAtStage).toBe("trusted_catalog_resolution");
    expect(result.blockers).toEqual(["trusted_pair_enrollment_not_registered"]);
    expect(result.pairAgreementReceipt).toBeNull();
    expectAllLocksClosed(result.claimLocks);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.claimLocks)).toBe(true);
    expect(
      result.stages.some((stage) => String(stage.state) === "pending"),
    ).toBe(false);
  });

  it("admits exactly three opaque IDs and rejects caller paths or extra policy", async () => {
    const coordinator = createNhm2SemiclassicalV2PairCoordinator();
    const withPath = await coordinator.run({
      ...request,
      scientificPresealArtifactId: "C:\\tmp\\preseal.json",
    });
    expect(withPath.blockers).toEqual(["coordinator_request_invalid"]);
    expect(withPath.stoppedAtStage).toBe("request_admission");

    const withPolicy = await coordinator.run({
      ...request,
      comparisonPolicy: { absoluteTolerance: 1 },
    } as any);
    expect(withPolicy.blockers).toEqual(["coordinator_request_invalid"]);
    expectAllLocksClosed(withPolicy.claimLocks);
  });

  it("rejects accessors, coercible values, and non-plain request prototypes without invoking user code", async () => {
    const coordinator = createNhm2SemiclassicalV2PairCoordinator();
    const getter = vi.fn(() => request.opaquePairEnrollmentId);
    const accessorRequest = {
      get opaquePairEnrollmentId() {
        return getter();
      },
      scientificPresealReceiptId: request.scientificPresealReceiptId,
      scientificPresealArtifactId: request.scientificPresealArtifactId,
    };
    const accessorResult = await coordinator.run(accessorRequest);
    expect(accessorResult.blockers).toEqual(["coordinator_request_invalid"]);
    expect(getter).not.toHaveBeenCalled();

    const toString = vi.fn(() => request.opaquePairEnrollmentId);
    const toPrimitive = vi.fn(() => request.opaquePairEnrollmentId);
    const coercible = {
      toString,
      [Symbol.toPrimitive]: toPrimitive,
    };
    const coercibleResult = await coordinator.run({
      ...request,
      opaquePairEnrollmentId: coercible,
    } as any);
    expect(coercibleResult.blockers).toEqual(["coordinator_request_invalid"]);
    expect(toString).not.toHaveBeenCalled();
    expect(toPrimitive).not.toHaveBeenCalled();

    const nonPlain = Object.assign(Object.create({ inherited: true }), request);
    const nonPlainResult = await coordinator.run(nonPlain);
    expect(nonPlainResult.blockers).toEqual(["coordinator_request_invalid"]);
  });

  it("does not invoke a structurally compatible but untrusted resolver", async () => {
    const resolve = vi.fn();
    const untrusted = {
      contractVersion:
        NHM2_SEMICLASSICAL_V2_PAIR_EXECUTION_CATALOG_CONTRACT_VERSION,
      resolve,
    } satisfies Nhm2SemiclassicalV2PairExecutionCatalogResolverV1;
    const result = await createNhm2SemiclassicalV2PairCoordinator({
      catalog: untrusted,
    }).run(request);
    expect(result.blockers).toEqual(["untrusted_catalog_resolver"]);
    expect(resolve).not.toHaveBeenCalled();
    expect(result.pairAgreementReceipt).toBeNull();
    expectAllLocksClosed(result.claimLocks);
  });

  it("never turns a test fixture enrollment into artifact authority", async () => {
    const forbiddenRunner = vi.fn(() => {
      throw new Error("runner_must_not_execute");
    });
    const enrollment = Object.freeze({
      opaquePairEnrollmentId: request.opaquePairEnrollmentId,
      lanes: [
        { executeAfterPersistedLaunchSeal: forbiddenRunner },
        { executeAfterPersistedLaunchSeal: forbiddenRunner },
      ],
    }) as unknown as Nhm2SemiclassicalV2PairTestCatalogRegistrationV1["enrollment"];
    const catalog = createTestOnlyNhm2SemiclassicalV2PairExecutionCatalog([
      { request, enrollment },
    ]);
    const result = await createNhm2SemiclassicalV2PairCoordinator({
      catalog,
    }).run(request);
    expect(result.authorityState).toBe("test_fixture_non_authoritative");
    expect(result.blockers).toEqual([
      "test_fixture_catalog_has_no_artifact_authority",
    ]);
    expect(forbiddenRunner).not.toHaveBeenCalled();
    expect(result.pairAgreementReceipt).toBeNull();
    expectAllLocksClosed(result.claimLocks);
  });

  it("publishes the fixed replay/comparator/contract continuation bindings", async () => {
    const result =
      await createNhm2SemiclassicalV2PairCoordinator().run(request);
    expect(result.componentBindings).toMatchObject({
      rawManifestValidatorInstalled: true,
      rawManifestPairValidatorInstalled: true,
      serverRunReplayerInstalled: true,
      exhaustivePairComparatorInstalled: true,
      pairAgreementValidatorInstalled: true,
      productionLifecycleEnabled: false,
      replayMetricLeafCount: 108,
      scientificPresealMaximumPersistedBytes: String(4 * 1024 * 1024),
    });
    expect(Object.values(result.claimLocks)).not.toContain(true);
    expect(NHM2_SEMICLASSICAL_V2_PAIR_COORDINATOR_BLOCKERS).toContain(
      "scientific_root_mount_identity_and_sealed_inventory_not_verified",
    );
    expect(
      result.claimLocks.scientificRootMountIdentityAndSealedInventoryVerified,
    ).toBe(false);
  });
});
