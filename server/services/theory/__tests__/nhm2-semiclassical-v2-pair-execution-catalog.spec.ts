import { describe, expect, it, vi } from "vitest";

import {
  createTestOnlyNhm2SemiclassicalV2PairExecutionCatalog,
  getDefaultNhm2SemiclassicalV2PairExecutionCatalog,
  getNhm2SemiclassicalV2PairCatalogAuthorityScope,
  type Nhm2SemiclassicalV2PairExecutionCatalogResolverV1,
  type Nhm2SemiclassicalV2PairTestCatalogRegistrationV1,
} from "../nhm2-semiclassical-v2-pair-execution-catalog";

const request = {
  opaquePairEnrollmentId: "pair-enrollment.opaque-1",
  scientificPresealReceiptId: "preseal-receipt.opaque-1",
  scientificPresealArtifactId: "preseal-artifact.opaque-1",
} as const;

describe("NHM2 semiclassical-v2 pair execution catalog", () => {
  it("ships with an empty production catalog and fails closed", async () => {
    const catalog = getDefaultNhm2SemiclassicalV2PairExecutionCatalog();
    expect(getNhm2SemiclassicalV2PairCatalogAuthorityScope(catalog)).toBe(
      "production_server_installed",
    );
    await expect(catalog.resolve(request)).resolves.toEqual({
      status: "blocked",
      blocker: "trusted_pair_enrollment_not_registered",
      detail:
        "No server-installed OS-isolated pair capability is registered for these opaque references.",
    });
  });

  it("rejects paths and shell-like values as opaque identifiers", async () => {
    const catalog = getDefaultNhm2SemiclassicalV2PairExecutionCatalog();
    await expect(
      catalog.resolve({
        ...request,
        opaquePairEnrollmentId: "C:\\pair\\primary",
      }),
    ).resolves.toMatchObject({
      status: "blocked",
      blocker: "pair_enrollment_id_invalid",
    });
    await expect(
      catalog.resolve({
        ...request,
        scientificPresealArtifactId: "preseal artifact --run",
      }),
    ).resolves.toMatchObject({
      status: "blocked",
      blocker: "pair_enrollment_id_invalid",
    });
    await expect(
      catalog.resolve({
        ...request,
        scientificPresealArtifactId: "tmp/preseal.json",
      }),
    ).resolves.toMatchObject({
      status: "blocked",
      blocker: "pair_enrollment_id_invalid",
    });
  });

  it("rejects accessors, coercible values, and non-plain request prototypes without invoking user code", async () => {
    const catalog = getDefaultNhm2SemiclassicalV2PairExecutionCatalog();
    const getter = vi.fn(() => request.opaquePairEnrollmentId);
    const accessorRequest = {
      get opaquePairEnrollmentId() {
        return getter();
      },
      scientificPresealReceiptId: request.scientificPresealReceiptId,
      scientificPresealArtifactId: request.scientificPresealArtifactId,
    };
    await expect(catalog.resolve(accessorRequest)).resolves.toMatchObject({
      status: "blocked",
      blocker: "pair_enrollment_id_invalid",
    });
    expect(getter).not.toHaveBeenCalled();

    const toString = vi.fn(() => request.opaquePairEnrollmentId);
    const toPrimitive = vi.fn(() => request.opaquePairEnrollmentId);
    const coercible = {
      toString,
      [Symbol.toPrimitive]: toPrimitive,
    };
    await expect(
      catalog.resolve({
        ...request,
        opaquePairEnrollmentId: coercible,
      } as any),
    ).resolves.toMatchObject({
      status: "blocked",
      blocker: "pair_enrollment_id_invalid",
    });
    expect(toString).not.toHaveBeenCalled();
    expect(toPrimitive).not.toHaveBeenCalled();

    const nonPlain = Object.assign(Object.create({ inherited: true }), request);
    await expect(catalog.resolve(nonPlain)).resolves.toMatchObject({
      status: "blocked",
      blocker: "pair_enrollment_id_invalid",
    });
  });

  it("marks explicit fixture registrations non-authoritative", async () => {
    const enrollment = Object.freeze({
      opaquePairEnrollmentId: request.opaquePairEnrollmentId,
    }) as unknown as Nhm2SemiclassicalV2PairTestCatalogRegistrationV1["enrollment"];
    const catalog = createTestOnlyNhm2SemiclassicalV2PairExecutionCatalog([
      { request, enrollment },
    ]);
    expect(getNhm2SemiclassicalV2PairCatalogAuthorityScope(catalog)).toBe(
      "test_fixture_non_authoritative",
    );
    await expect(catalog.resolve(request)).resolves.toEqual({
      status: "resolved",
      enrollment,
    });
    await expect(
      catalog.resolve({
        ...request,
        scientificPresealReceiptId: "preseal-receipt.opaque-2",
      }),
    ).resolves.toMatchObject({
      status: "blocked",
      blocker: "trusted_pair_enrollment_not_registered",
    });
  });

  it("rejects reflected-constructor attempts to forge production authority", () => {
    const catalog = getDefaultNhm2SemiclassicalV2PairExecutionCatalog();
    const ReflectedConstructor = Object.getPrototypeOf(catalog).constructor as new (
      ...args: unknown[]
    ) => Nhm2SemiclassicalV2PairExecutionCatalogResolverV1;
    const arbitraryRegistration = {
      request,
      enrollment: Object.freeze({
        opaquePairEnrollmentId: request.opaquePairEnrollmentId,
      }),
    };

    expect(
      () =>
        new ReflectedConstructor(
          "production_server_installed",
          [arbitraryRegistration],
        ),
    ).toThrow("nhm2_pair_catalog_construction_capability_required");
    expect(
      () =>
        new ReflectedConstructor(
          Symbol("guessed-capability"),
          "production_server_installed",
          [arbitraryRegistration],
        ),
    ).toThrow("nhm2_pair_catalog_construction_capability_required");

    const prototypeOnly = Object.create(
      Object.getPrototypeOf(catalog),
    ) as Nhm2SemiclassicalV2PairExecutionCatalogResolverV1;
    expect(getNhm2SemiclassicalV2PairCatalogAuthorityScope(prototypeOnly)).toBeNull();
  });
});
