import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  NHM2_SPHERICAL_BOSON_STAR_V2_PRE_PRESEAL_STATIC_INPUT_ROLES_V2,
  NHM2_SPHERICAL_BOSON_STAR_V2_PREEXECUTION_PROFILE_V2_BINDING,
} from "../../../../shared/contracts/nhm2-spherical-boson-star-v2-preexecution-profile.v2";
import { NHM2_SPHERICAL_BOSON_STAR_V2_RUN_ARTIFACT_WIRE_V2_BINDING } from "../../../../shared/contracts/nhm2-spherical-boson-star-v2-run-artifact-wire.v2";
import { NHM2_SPHERICAL_BOSON_STAR_V2_SCIENTIFIC_PRESEAL_ENVELOPE_BINDING } from "../../../../shared/contracts/nhm2-spherical-boson-star-v2-scientific-preseal-envelope.v1";
import {
  NHM2_SPHERICAL_BOSON_STAR_V2_SCIENTIFIC_PRESEAL_PERSISTENCE_RECEIPT_BINDING,
  NHM2_SPHERICAL_BOSON_STAR_V2_SCIENTIFIC_PRESEAL_PERSISTENCE_RECEIPT_REQUIRED_DEPENDENCY_BINDINGS,
} from "../../../../shared/contracts/nhm2-spherical-boson-star-v2-scientific-preseal-persistence-receipt.v1";
import {
  NHM2_SPHERICAL_BOSON_STAR_V2_EXECUTION_PRESEAL_WIRE_BINDING,
  NHM2_SPHERICAL_BOSON_STAR_V2_EXECUTION_PRESEAL_WIRE_CONTRACT,
  NHM2_SPHERICAL_BOSON_STAR_V2_EXECUTION_PRESEAL_WIRE_REQUIRED_DEPENDENCY_BINDINGS,
} from "../../../../shared/contracts/nhm2-spherical-boson-star-v2-execution-preseal-wire.v1";

type BoundaryModule =
  typeof import("../nhm2-spherical-boson-star-v2-preexecution-evidence-issuer");

const loadBoundary = (): Promise<BoundaryModule> =>
  import("../nhm2-spherical-boson-star-v2-preexecution-evidence-issuer");

const SOURCE_PATH = fileURLToPath(
  new URL(
    "../nhm2-spherical-boson-star-v2-preexecution-evidence-issuer.ts",
    import.meta.url,
  ),
);

const expectDeepFrozen = (root: object): void => {
  const pending: object[] = [root];
  const visited = new Set<object>();
  while (pending.length > 0) {
    const value = pending.pop();
    if (value === undefined || visited.has(value)) continue;
    visited.add(value);
    expect(Object.isFrozen(value)).toBe(true);
    for (const child of Object.values(value))
      if (child !== null && typeof child === "object") pending.push(child);
  }
};

const BASE_BLOCKER_ORDER = [
  "server_private_enrollment_allocator_not_installed",
  "exact_12_role_static_input_instance_absent",
  "scientific_preseal_p_allocation_absent",
  "runtime_control_artifact_allocation_absent",
  "paired_output_root_allocation_absent",
  "linux_native_observation_provider_not_installed",
  "openat2_beneath_observer_not_installed",
  "statx_identity_observer_not_installed",
  "clock_monotonic_raw_observer_not_installed",
  "directory_fsync_observer_not_installed",
  "runtime_loader_observer_not_installed",
  "syscall_trace_observer_not_installed",
  "launch_envelope_provider_not_installed",
  "remaining_mean_noise_constraint_science_instances_absent",
  "exact_68_file_atomic_publisher_not_installed",
  "execution_not_authorized",
] as const;

describe("spherical-v2 preexecution evidence boundary", () => {
  it("pins the exact final A/S/P/PR/E seals and the PR/E dependency tuples", async () => {
    const { NHM2_SPHERICAL_BOSON_STAR_V2_PREEXECUTION_EVIDENCE_BOUNDARY } =
      await loadBoundary();
    const pins = NHM2_SPHERICAL_BOSON_STAR_V2_PREEXECUTION_EVIDENCE_BOUNDARY;

    expect(pins.exactContractSeals).toEqual({
      A: {
        sha256:
          "dce4c293d09224e4b7d79bd8b04b46542875f0306eecee84c35bb4c10bf68cb8",
        canonicalSizeBytes: 11_663,
      },
      S: {
        sha256:
          "d681751c9f0cec9e10336f98bb4c6a2657411bc74d612313660692363202971d",
        canonicalSizeBytes: 11_117,
      },
      P: {
        sha256:
          "b832aefb663b08cc9982d7ffb6ee0d21eea4a3453aa4aec6c22ab3cd6d2ccbca",
        canonicalSizeBytes: 10_551,
      },
      PR: {
        sha256:
          "4c4112703dc13778d7053287fa03f0a22fb532ea09c9dad5b0b7046757140605",
        canonicalSizeBytes: 8_306,
      },
      E: {
        sha256:
          "b9ef8ec056ce931e23aca660ab978f7861a2222d6658772e52e6cdca66a57987",
        canonicalSizeBytes: 13_524,
      },
    });
    expect(pins.exactContractBindings).toEqual({
      A: NHM2_SPHERICAL_BOSON_STAR_V2_PREEXECUTION_PROFILE_V2_BINDING,
      S: NHM2_SPHERICAL_BOSON_STAR_V2_RUN_ARTIFACT_WIRE_V2_BINDING,
      P: NHM2_SPHERICAL_BOSON_STAR_V2_SCIENTIFIC_PRESEAL_ENVELOPE_BINDING,
      PR: NHM2_SPHERICAL_BOSON_STAR_V2_SCIENTIFIC_PRESEAL_PERSISTENCE_RECEIPT_BINDING,
      E: NHM2_SPHERICAL_BOSON_STAR_V2_EXECUTION_PRESEAL_WIRE_BINDING,
    });
    expect(pins.exactRequiredDependencyBindings).toEqual({
      PR: NHM2_SPHERICAL_BOSON_STAR_V2_SCIENTIFIC_PRESEAL_PERSISTENCE_RECEIPT_REQUIRED_DEPENDENCY_BINDINGS,
      E: NHM2_SPHERICAL_BOSON_STAR_V2_EXECUTION_PRESEAL_WIRE_REQUIRED_DEPENDENCY_BINDINGS,
    });
    expect(pins.dependencyObservation).toEqual({
      exactLiteralPinsCheckedAtModuleLoad: true,
      callerDependencyBytesAccepted: false,
      callerDependencyBindingsAccepted: false,
      rawDependencyBytesObserved: false,
    });
  });

  it("returns the complete typed blocker list in frozen deterministic order", async () => {
    const module = await loadBoundary();
    const result =
      module.assessNhm2SphericalBosonStarV2PreexecutionEvidenceRequest(
        "lane:enrollment-01",
      );
    const expected =
      process.platform === "linux"
        ? [...BASE_BLOCKER_ORDER]
        : ["current_platform_not_linux", ...BASE_BLOCKER_ORDER];

    expect(
      module.assessNhm2SphericalBosonStarV2PreexecutionEvidenceRequest.length,
    ).toBe(1);
    expect(result).toEqual({
      artifactId: "nhm2.spherical_boson_star_v2_preexecution_evidence_boundary",
      contractVersion:
        "nhm2_spherical_boson_star_v2_preexecution_evidence_boundary/v1",
      status: "blocked",
      phase: "preexecution_evidence_not_issued",
      enrollmentIdAccepted: true,
      currentPlatform: process.platform,
      blockers: expected,
      launchAuthorized: false,
      launchPerformed: false,
      executionAuthorized: false,
      executionPerformed: false,
      replayClosed: false,
      viability: null,
      authority: null,
    });
    expect(result.blockers).toEqual(expected);
    expect(
      module.NHM2_SPHERICAL_BOSON_STAR_V2_PREEXECUTION_EVIDENCE_BOUNDARY
        .publicBlockerOrder,
    ).toEqual(expected);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.blockers)).toBe(true);
  });

  it("rejects non-string hostile inputs before traps and bounds primitive strings", async () => {
    const {
      assessNhm2SphericalBosonStarV2PreexecutionEvidenceRequest: assess,
    } = await loadBoundary();
    let traps = 0;
    const hostile = new Proxy(Object.create(null) as Record<string, unknown>, {
      get: () => {
        traps += 1;
        throw new Error("unexpected_get");
      },
      ownKeys: () => {
        traps += 1;
        throw new Error("unexpected_own_keys");
      },
      getOwnPropertyDescriptor: () => {
        traps += 1;
        throw new Error("unexpected_descriptor");
      },
      getPrototypeOf: () => {
        traps += 1;
        throw new Error("unexpected_prototype");
      },
    });
    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessor, "enrollmentId", {
      enumerable: true,
      get: () => {
        traps += 1;
        throw new Error("unexpected_accessor");
      },
    });

    for (const value of [hostile, accessor, null, undefined, 1, 1n, Symbol()])
      expect(assess(value)).toMatchObject({
        status: "blocked",
        enrollmentIdAccepted: false,
        blockers: ["enrollment_id_primitive_string_required"],
      });
    expect(traps).toBe(0);

    expect(assess("").blockers).toEqual(["enrollment_id_empty"]);
    expect(assess("a".repeat(129)).blockers).toEqual([
      "enrollment_id_code_unit_limit_exceeded",
    ]);
    expect(assess("\u20ac".repeat(86)).blockers).toEqual([
      "enrollment_id_utf8_limit_exceeded",
    ]);
    for (const value of ["a/b", "a\\b", "a b", "e\u0301", "\u00e9"])
      expect(assess(value).blockers).toEqual(["enrollment_id_not_canonical"]);
  });

  it("rejects forged, copied, serialized, accessor, and proxy capabilities without traps", async () => {
    const { consumeNhm2SphericalBosonStarV2PreexecutionCapability: consume } =
      await loadBoundary();
    let traps = 0;
    const hostile = new Proxy(Object.create(null) as Record<string, unknown>, {
      get: () => {
        traps += 1;
        throw new Error("unexpected_get");
      },
      ownKeys: () => {
        traps += 1;
        throw new Error("unexpected_own_keys");
      },
      getOwnPropertyDescriptor: () => {
        traps += 1;
        throw new Error("unexpected_descriptor");
      },
      getPrototypeOf: () => {
        traps += 1;
        throw new Error("unexpected_prototype");
      },
    });
    const hostileFunction = new Proxy(() => undefined, {
      get: () => {
        traps += 1;
        throw new Error("unexpected_function_get");
      },
    });
    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessor, "receiptSha256", {
      enumerable: true,
      get: () => {
        traps += 1;
        throw new Error("unexpected_receipt_accessor");
      },
    });
    const forged = Object.freeze({ consumed: false, brand: "server" });
    const copied = { ...forged };
    const serialized = JSON.parse(JSON.stringify(forged)) as unknown;

    expect(consume.length).toBe(1);
    for (const value of [
      hostile,
      hostileFunction,
      accessor,
      forged,
      copied,
      serialized,
      { artifactId: "SR" },
      { artifactId: "PR" },
      { artifactId: "FR" },
      { artifactId: "OR" },
      { artifactId: "ER" },
      null,
      "receipt",
    ])
      expect(consume(value)).toEqual({
        status: "blocked",
        capabilityAuthenticated: false,
        capabilityConsumed: false,
        blocker: "server_minted_preexecution_capability_required",
        launchAuthorized: false,
        executionAuthorized: false,
        authority: null,
      });
    expect(traps).toBe(0);
  });

  it("freezes the truthful non-executed chronology, providers, receipts, lamps, and outcomes", async () => {
    const { NHM2_SPHERICAL_BOSON_STAR_V2_PREEXECUTION_EVIDENCE_BOUNDARY: b } =
      await loadBoundary();

    expect(b.stateMachine.exactCanonicalChronology).toEqual(
      NHM2_SPHERICAL_BOSON_STAR_V2_EXECUTION_PRESEAL_WIRE_CONTRACT.exactCanonicalBundleOrder,
    );
    expect(b.stateMachine.stages.map(({ id }) => id)).toEqual([
      "A",
      "S",
      "SR",
      "P",
      "PR",
      "F",
      "FR",
      "O",
      "OR",
      "E",
      "ER",
    ]);
    expect(b.stateMachine.stages).toSatisfy(
      (stages: typeof b.stateMachine.stages) =>
        stages.every(
          (stage) => stage.executed === false && stage.instance === null,
        ),
    );
    expect(b.stateMachine.chronologyObserved).toBe(false);
    expect(b.stateMachine.chronologySatisfied).toBe(false);
    expect(Object.keys(b.plainReceiptAuthentication)).toEqual([
      "SR",
      "PR",
      "FR",
      "OR",
      "ER",
      "genericReceiptPromotionAllowed",
    ]);
    expect(Object.values(b.plainReceiptAuthentication)).toSatisfy(
      (values: readonly boolean[]) => values.every((value) => value === false),
    );
    expect(b.providerRequirements).toHaveLength(14);
    expect(b.providerRequirements).toSatisfy(
      (requirements: typeof b.providerRequirements) =>
        requirements.every(
          (entry) =>
            entry.required === true &&
            entry.installed === false &&
            entry.instance === null &&
            entry.callerInstallationAllowed === false &&
            entry.executionPerformed === false,
        ),
    );
    expect(
      NHM2_SPHERICAL_BOSON_STAR_V2_PRE_PRESEAL_STATIC_INPUT_ROLES_V2,
    ).toHaveLength(12);
    expect(Object.values(b.instances)).toSatisfy((values: readonly null[]) =>
      values.every((value) => value === null),
    );
    expect(Object.values(b.lamps)).toSatisfy((values: readonly boolean[]) =>
      values.every((value) => value === false),
    );
    expect(b.outcomes).toEqual({
      launchAuthorized: false,
      launchPerformed: false,
      executionAuthorized: false,
      executionPerformed: false,
      replayClosed: false,
      viability: null,
      authority: null,
    });
    expectDeepFrozen(b);
  });

  it("fails module loading when a live final seal drifts", async () => {
    vi.resetModules();
    vi.doMock(
      "../../../../shared/contracts/nhm2-spherical-boson-star-v2-execution-preseal-wire.v1",
      async () => {
        const actual = await vi.importActual<
          typeof import("../../../../shared/contracts/nhm2-spherical-boson-star-v2-execution-preseal-wire.v1")
        >(
          "../../../../shared/contracts/nhm2-spherical-boson-star-v2-execution-preseal-wire.v1",
        );
        return {
          ...actual,
          NHM2_SPHERICAL_BOSON_STAR_V2_EXECUTION_PRESEAL_WIRE_BINDING:
            Object.freeze({
              ...actual.NHM2_SPHERICAL_BOSON_STAR_V2_EXECUTION_PRESEAL_WIRE_BINDING,
              sha256: "0".repeat(64),
            }),
        };
      },
    );
    try {
      await expect(loadBoundary()).rejects.toThrow(
        "spherical_v2_preexecution_evidence_contract_seal_drift",
      );
    } finally {
      vi.doUnmock(
        "../../../../shared/contracts/nhm2-spherical-boson-star-v2-execution-preseal-wire.v1",
      );
      vi.resetModules();
    }
  });

  it("exports no issuance surface and contains no filesystem, process-execution, provider-injection, or success path", async () => {
    const module = await loadBoundary();
    expect(Object.keys(module).sort()).toEqual([
      "NHM2_SPHERICAL_BOSON_STAR_V2_PREEXECUTION_EVIDENCE_BOUNDARY",
      "assessNhm2SphericalBosonStarV2PreexecutionEvidenceRequest",
      "consumeNhm2SphericalBosonStarV2PreexecutionCapability",
    ]);

    const source = readFileSync(SOURCE_PATH, "utf8");
    expect(
      Array.from(source.matchAll(/from\s+"([^"]+)"/g), (match) => match[1]),
    ).toEqual([
      "../../../shared/contracts/nhm2-spherical-boson-star-v2-preexecution-profile.v2",
      "../../../shared/contracts/nhm2-spherical-boson-star-v2-run-artifact-wire.v2",
      "../../../shared/contracts/nhm2-spherical-boson-star-v2-scientific-preseal-envelope.v1",
      "../../../shared/contracts/nhm2-spherical-boson-star-v2-scientific-preseal-persistence-receipt.v1",
      "../../../shared/contracts/nhm2-spherical-boson-star-v2-execution-preseal-wire.v1",
    ]);
    for (const forbidden of [
      /node:(?:fs|child_process|worker_threads|cluster|net)/,
      /\b(?:spawn|spawnSync|exec|execSync|execFile|fork)\s*\(/,
      /\b(?:readFile|writeFile|mkdir|rename|unlink|open|close|stat|lstat|fsync)\s*\(/,
      /\bprocess\.(?:argv|env|cwd|chdir|kill|exit|abort|binding)\b/,
      /\b(?:Date\.now|performance\.now|Math\.random)\b/,
      /\b(?:setTimeout|setInterval|queueMicrotask)\s*\(/,
      /\bWeakSet\b/,
      /\bSERVER_CAPABILITY_STATES\.set\s*\(/,
      /export\s+(?:const|function|class)\s+\w*(?:issue|mint|install|register|provider)/i,
      /\bstatus:\s*["'](?:ready|success|issued|executed)["']/,
      /\b(?:setProvider|installProvider|registerProvider|providerFactory)\b/,
      /\b(?:eval|Function)\s*\(/,
    ])
      expect(source).not.toMatch(forbidden);
    expect(source.match(/\bprocess\.platform\b/g)).toHaveLength(1);
    expect(source.match(/new WeakMap</g)).toHaveLength(1);
    expect(source).not.toContain("CAPABILITY_STATES.set");
    expect(source).not.toContain("authenticatedObservationContext: true");
  });
});
