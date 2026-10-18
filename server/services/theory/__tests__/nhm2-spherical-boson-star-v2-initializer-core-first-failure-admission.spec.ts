import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  observeNhm2SphericalBosonStarV2InitializerFirstFailure,
  requireNhm2SphericalBosonStarV2InitializerFirstFailure,
} from "../nhm2-spherical-boson-star-v2-initializer-core-first-failure-admission";

describe("NHM2 spherical boson-star v2 initializer first-failure admission", () => {
  it("mints an identity-only capability over the exact server-observed receipt", () => {
    const capability = observeNhm2SphericalBosonStarV2InitializerFirstFailure();
    const observation =
      requireNhm2SphericalBosonStarV2InitializerFirstFailure(capability);

    expect(observation.status).toBe(
      "server_authenticated_diagnostic_first_failure_observed",
    );
    expect(observation.checkpoint).toEqual({
      gridNodeCount: 64,
      amplitude: "2^-16",
      requestedCandidateCheckpointReached: false,
    });
    expect(observation.failure).toEqual({
      code: "armijo_schedule_exhausted_without_retry",
      equationLinf: 6.052214285290347e-11,
      stateF64leSha256:
        "601af0c0de01be4bb5a2abc0dc743cae57397a50c9406720856ae396c7325e50",
      residualF64leSha256:
        "13418bbf6f97925754b7dd999b1e70e2d2495d2efb4993f61ee98cf4be62dc17",
    });
    expect(observation.receipt).toMatchObject({
      rawSha256:
        "34133d2c5e077b92618ea9420975f165c01134f5ab06c46f1e4eb4127bde730a",
      sizeBytes: 6837,
      selfSha256:
        "cb9c36432486b4138ad01b8c8beebaca4eecb480fdd54a9a5f57a5030c4ed0cb",
    });
    expect(readFileSync(observation.receipt.path)).toHaveLength(6837);
    expect(observation.sourceImplementationDisjoint).toBe(true);
    expect(observation.runtimeLineageDisjoint).toBe(false);
    expect(observation.qualifiesAsRuntimeDisjointIndependentReplay).toBe(false);
    expect(observation.receiptDeclaredServerAuthenticatedObservation).toBe(
      false,
    );
    expect(observation.serverOwnedExactByteObservation).toBe(true);
    expect(observation.serverCapabilityIdentityAuthenticated).toBe(true);
    expect(Object.values(observation.authority)).toEqual(
      Array(Object.keys(observation.authority).length).fill(false),
    );
    expect(Object.isFrozen(observation)).toBe(true);
    expect(Object.isFrozen(observation.checkpoint)).toBe(true);
    expect(Object.isFrozen(observation.failure)).toBe(true);
    expect(Object.isFrozen(observation.receipt)).toBe(true);
  });

  it("rejects copied, serialized, constructed, and stale-shaped capabilities", () => {
    const capability = observeNhm2SphericalBosonStarV2InitializerFirstFailure();
    const copy = { ...capability };
    const serialized = JSON.parse(JSON.stringify(capability));

    expect(() =>
      requireNhm2SphericalBosonStarV2InitializerFirstFailure(copy),
    ).toThrow("initializer_first_failure_capability_identity_required");
    expect(() =>
      requireNhm2SphericalBosonStarV2InitializerFirstFailure(serialized),
    ).toThrow("initializer_first_failure_capability_identity_required");
    expect(() =>
      requireNhm2SphericalBosonStarV2InitializerFirstFailure(Object.freeze({})),
    ).toThrow("initializer_first_failure_capability_identity_required");
    expect(
      requireNhm2SphericalBosonStarV2InitializerFirstFailure(capability).failure
        .code,
    ).toBe("armijo_schedule_exhausted_without_retry");
  });

  it("observes exact zero arity without traversing hostile values", () => {
    let reads = 0;
    const hostile = new Proxy(
      {},
      {
        get() {
          reads += 1;
          throw new Error("trap");
        },
        ownKeys() {
          reads += 1;
          throw new Error("trap");
        },
      },
    );

    expect(() =>
      observeNhm2SphericalBosonStarV2InitializerFirstFailure(hostile),
    ).toThrow("initializer_first_failure_observer_zero_arguments_required");
    expect(reads).toBe(0);
  });

  it("checks WeakMap identity without reading hostile capability properties", () => {
    let reads = 0;
    const hostile = new Proxy(
      {},
      {
        get() {
          reads += 1;
          throw new Error("trap");
        },
        getPrototypeOf() {
          reads += 1;
          throw new Error("trap");
        },
      },
    );

    expect(() =>
      requireNhm2SphericalBosonStarV2InitializerFirstFailure(hostile),
    ).toThrow("initializer_first_failure_capability_identity_required");
    expect(reads).toBe(0);
  });

  it("exports no issuer, installer, provider, path, or authority promotion API", async () => {
    const module =
      await import("../nhm2-spherical-boson-star-v2-initializer-core-first-failure-admission");
    expect(Object.keys(module).sort()).toEqual([
      "observeNhm2SphericalBosonStarV2InitializerFirstFailure",
      "requireNhm2SphericalBosonStarV2InitializerFirstFailure",
    ]);
    const source = readFileSync(
      new URL(
        "../nhm2-spherical-boson-star-v2-initializer-core-first-failure-admission.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).not.toMatch(
      /child_process|process\.env|WeakMap<[^>]+>\.set/,
    );
    expect(source).not.toMatch(/physicalViability:\s*true|execution:\s*true/);
  });
});
