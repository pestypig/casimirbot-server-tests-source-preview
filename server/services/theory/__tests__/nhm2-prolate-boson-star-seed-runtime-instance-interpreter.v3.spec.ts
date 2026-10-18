import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_RUN_PLAN_V3_EVIDENCE_SCHEMA_REGISTRY } from "../../../../shared/contracts/nhm2-prolate-boson-star-newtonian-seed-run-plan.v3";
import {
  NHM2_PROLATE_BOSON_STAR_SEED_RUN_EVIDENCE_INTERPRETER_VERSION,
  interpretNhm2ProlateBosonStarSeedRunEvidenceV1,
} from "../nhm2-prolate-boson-star-seed-run-evidence-interpreter";
import {
  NHM2_PROLATE_BOSON_STAR_SEED_RUNTIME_INSTANCE_AUTHORITY_LOCKS_V3,
  NHM2_PROLATE_BOSON_STAR_SEED_RUNTIME_INSTANCE_SUPPORTED_PROFILES_V3,
  interpretNhm2ProlateBosonStarSeedRuntimeInstanceV3,
} from "../nhm2-prolate-boson-star-seed-runtime-instance-interpreter.v3";

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("unsupported_test_value");
    return encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
};

const rootPrestateValue = () => {
  const schema =
    NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_RUN_PLAN_V3_EVIDENCE_SCHEMA_REGISTRY
      .schemas.rootPrestateReceipt;
  const domain = schema.listingHashPolicy.domain;
  const listingSha256 = createHash("sha256")
    .update(Buffer.concat([Buffer.from(domain, "utf8"), Buffer.alloc(8)]))
    .digest("hex");
  return {
    schemaVersion:
      "nhm2_prolate_boson_star_newtonian_seed_v3_root_prestate_receipt/v1",
    absoluteRootPath: "/run/staging",
    deviceId: "1",
    inode: "2",
    mountId: "3",
    ownerUid: "4",
    ownerGid: "5",
    modeOctal: "0750",
    linkCount: 1,
    recursiveEntryCount: 0,
    listingSha256,
    secureResolution:
      "openat2_RESOLVE_BENEATH_NO_SYMLINKS_NO_MAGICLINKS_NO_XDEV",
    observationMonotonicNanoseconds: "1000",
    empty: true,
  };
};

const rootPrestateBytes = (value: unknown = rootPrestateValue()): Buffer =>
  Buffer.from(canonicalJson(value), "utf8");

const fileObservationValue = () => ({
  absolutePath: "/run/replay/seed-verifier-replay-bundle.canonical.json",
  byteLength: 4096,
  sha256: "a".repeat(64),
  mountId: "11",
  deviceId: "12",
  inode: "13",
  linkCount: 1,
  modeFileType: "regular_file",
  mtimeNanoseconds: "14",
  ctimeNanoseconds: "15",
  secureResolutionPassed: true,
  statReadStatStable: true,
});

const fileObservationBytes = (
  value: unknown = fileObservationValue(),
): Buffer => Buffer.from(canonicalJson(value), "utf8");

describe("NHM2 prolate boson-star seed v3 runtime-instance interpreter", () => {
  it("preserves the v1 interpreter API and adds no launch or registration authority", () => {
    expect(NHM2_PROLATE_BOSON_STAR_SEED_RUN_EVIDENCE_INTERPRETER_VERSION).toBe(
      "nhm2_prolate_boson_star_seed_run_evidence_interpreter/v1",
    );
    expect(typeof interpretNhm2ProlateBosonStarSeedRunEvidenceV1).toBe(
      "function",
    );
    expect(
      Object.values(
        NHM2_PROLATE_BOSON_STAR_SEED_RUNTIME_INSTANCE_AUTHORITY_LOCKS_V3,
      ).every((value) => value === false),
    ).toBe(true);
    expect(
      NHM2_PROLATE_BOSON_STAR_SEED_RUNTIME_INSTANCE_SUPPORTED_PROFILES_V3,
    ).toEqual(["verifierChannelObservation", "assemblerChannelObservation"]);
  });

  it("resolves the sealed 41-schema/49-profile/49-cap registry and accepts one exact bounded instance", () => {
    const registry =
      NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_RUN_PLAN_V3_EVIDENCE_SCHEMA_REGISTRY;
    expect(Object.keys(registry.schemas)).toHaveLength(41);
    expect(Object.keys(registry.bindingProfiles)).toHaveLength(49);
    expect(
      Object.keys(
        registry.runtimeInstanceResourcePolicy
          .maximumCanonicalUtf8BytesByRuntimeProfile,
      ),
    ).toHaveLength(49);

    const bytes = fileObservationBytes();
    for (const runtimeProfile of Object.keys(registry.bindingProfiles)) {
      const trivial = interpretNhm2ProlateBosonStarSeedRuntimeInstanceV3(
        runtimeProfile,
        Buffer.from("null", "utf8"),
      );
      expect(
        trivial,
        `${runtimeProfile}:must resolve before schema rejection`,
      ).not.toMatchObject({ code: "unknown_runtime_profile" });
      if (
        runtimeProfile !== "verifierChannelObservation" &&
        runtimeProfile !== "assemblerChannelObservation"
      ) {
        expect(trivial.ok, `${runtimeProfile}:must remain fail-closed`).toBe(
          false,
        );
      }
    }

    const first = interpretNhm2ProlateBosonStarSeedRuntimeInstanceV3(
      "verifierChannelObservation",
      bytes,
    );
    expect(first.ok).toBe(true);
    if (first.ok === false) throw new Error(first.code);
    const result = interpretNhm2ProlateBosonStarSeedRuntimeInstanceV3(
      "verifierChannelObservation",
      bytes,
      first.binding,
    );

    expect(result).toMatchObject({
      ok: true,
      runtimeProfile: "verifierChannelObservation",
      schemaName: "importedPrimitiveSchemaRegistry.schemas.fileObservation",
      assertedBindingMatched: true,
      checks: {
        registryCardinalityExact: true,
        profileSchemaBindingDomainExact: true,
        boundedDuplicateAwareTokenizationPassed: true,
        recursiveExactSchemaAndProfileValidationPassed: true,
        crossFieldInvariantsReplayed: true,
        canonicalUtf8Exact: true,
        domainSeparatedBindingRecomputed: true,
        launchOrRegistrationAuthorityGranted: false,
      },
    });
    expect(Object.values(result.authorityLocks).every((value) => !value)).toBe(
      true,
    );
  });

  it("selects the exact profile cap, permits exact-cap input to reach tokenization, and rejects cap+1 first", () => {
    const cap =
      NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_RUN_PLAN_V3_EVIDENCE_SCHEMA_REGISTRY
        .runtimeInstanceResourcePolicy.maximumCanonicalUtf8BytesByRuntimeProfile
        .rootPrestateReceipt;
    const exactCap = interpretNhm2ProlateBosonStarSeedRuntimeInstanceV3(
      "rootPrestateReceipt",
      Buffer.alloc(cap, 0x20),
    );
    expect(exactCap).toMatchObject({
      ok: false,
      code: "invalid_json_token_or_encoding",
      rejectionReceipt: {
        maximumCanonicalUtf8BytesOrNull: cap,
        declaredByteLengthOrNull: cap,
        observedByteLengthOrNull: cap,
      },
    });

    const overCap = interpretNhm2ProlateBosonStarSeedRuntimeInstanceV3(
      "rootPrestateReceipt",
      Buffer.alloc(cap + 1, 0x20),
    );
    expect(overCap).toMatchObject({
      ok: false,
      code: "file_size_cap_exceeded",
      rejectionReceipt: {
        maximumCanonicalUtf8BytesOrNull: cap,
        declaredByteLengthOrNull: cap + 1,
        observedByteLengthOrNull: cap + 1,
        canonicalizationCompleted: false,
        bindingCreated: false,
        registrationAllowed: false,
      },
    });
  });

  it("rejects an unknown profile before inspecting bytes and leaves every receipt authority false", () => {
    const result = interpretNhm2ProlateBosonStarSeedRuntimeInstanceV3(
      "not_registered",
      Buffer.alloc(4 * 1024 * 1024, 0xff),
      { hostile: true },
    );
    expect(result).toMatchObject({
      ok: false,
      code: "unknown_runtime_profile",
      rejectionReceipt: {
        attemptedFileObservationOrNull: null,
        attemptedInstanceBindingOrNull: null,
        declaredByteLengthOrNull: null,
        observedByteLengthOrNull: null,
        maximumCanonicalUtf8BytesOrNull: null,
        canonicalizationCompleted: false,
        bindingCreated: false,
        interpretationAccepted: false,
        registrationAllowed: false,
        executionAuthorized: false,
        seedAdmissionGranted: false,
        artifactAccepted: false,
        scientificAdmissionGranted: false,
        physicalAuthorityGranted: false,
        propulsionAuthorityGranted: false,
        transportAuthorityGranted: false,
        allPassed: false,
      },
    });
    expect(Object.values(result.authorityLocks).every((value) => !value)).toBe(
      true,
    );
  });

  it("uses duplicate-aware tokenization and rejects negative zero before canonicalization", () => {
    expect(
      interpretNhm2ProlateBosonStarSeedRuntimeInstanceV3(
        "rootPrestateReceipt",
        Buffer.from('{"x":1,"x":2}', "utf8"),
      ),
    ).toMatchObject({
      ok: false,
      code: "duplicate_object_key",
      rejectionReceipt: {
        firstJsonPointerOrNull: "/x",
        canonicalizationCompleted: false,
      },
    });
    expect(
      interpretNhm2ProlateBosonStarSeedRuntimeInstanceV3(
        "rootPrestateReceipt",
        Buffer.from('{"x":-0}', "utf8"),
      ),
    ).toMatchObject({
      ok: false,
      code: "negative_zero_forbidden",
      rejectionReceipt: { canonicalizationCompleted: false },
    });
  });

  it("enforces invalid UTF-8, numeric-token, depth, and string rails deterministically", () => {
    expect(
      interpretNhm2ProlateBosonStarSeedRuntimeInstanceV3(
        "rootPrestateReceipt",
        Uint8Array.from([0xff]),
      ),
    ).toMatchObject({ ok: false, code: "invalid_json_token_or_encoding" });

    expect(
      interpretNhm2ProlateBosonStarSeedRuntimeInstanceV3(
        "rootPrestateReceipt",
        Buffer.from(`{"x":${"1".repeat(129)}}`, "utf8"),
      ),
    ).toMatchObject({
      ok: false,
      code: "maximum_numeric_token_bytes_exceeded",
    });

    const deep = `${"[".repeat(258)}0${"]".repeat(258)}`;
    expect(
      interpretNhm2ProlateBosonStarSeedRuntimeInstanceV3(
        "rootPrestateReceipt",
        Buffer.from(deep, "utf8"),
      ),
    ).toMatchObject({ ok: false, code: "maximum_depth_exceeded" });

    const oversizedString = `{"x":"${"a".repeat(1024 * 1024 + 1)}"}`;
    expect(
      interpretNhm2ProlateBosonStarSeedRuntimeInstanceV3(
        "rootPrestateReceipt",
        Buffer.from(oversizedString, "utf8"),
      ),
    ).toMatchObject({
      ok: false,
      code: "maximum_string_utf8_bytes_exceeded",
    });
  });

  it("enforces the registered node, object-key, per-object-key, and array rails", () => {
    const policy =
      NHM2_PROLATE_BOSON_STAR_NEWTONIAN_SEED_RUN_PLAN_V3_EVIDENCE_SCHEMA_REGISTRY
        .runtimeInstanceResourcePolicy.tokenizerAndStructureBudgets;

    const overlongArray = `[${"0,".repeat(policy.maximumArrayLength)}0]`;
    expect(
      interpretNhm2ProlateBosonStarSeedRuntimeInstanceV3(
        "rootPrestateReceipt",
        Buffer.from(overlongArray, "utf8"),
      ),
    ).toMatchObject({
      ok: false,
      code: "maximum_array_length_exceeded",
    });

    const tooManyKeys = `{${Array.from(
      { length: policy.maximumKeysPerObject + 1 },
      (_, index) => `"k${index}":0`,
    ).join(",")}}`;
    expect(
      interpretNhm2ProlateBosonStarSeedRuntimeInstanceV3(
        "rootPrestateReceipt",
        Buffer.from(tooManyKeys, "utf8"),
      ),
    ).toMatchObject({
      ok: false,
      code: "maximum_keys_per_object_exceeded",
    });

    const nodesPerArray = Math.floor(policy.maximumTotalNodes / 3);
    const nodeArray = `[${"0,".repeat(nodesPerArray - 1)}0]`;
    const tooManyNodes = `[${nodeArray},${nodeArray},${nodeArray}]`;
    expect(
      interpretNhm2ProlateBosonStarSeedRuntimeInstanceV3(
        "compositeReplayBundle",
        Buffer.from(tooManyNodes, "utf8"),
      ),
    ).toMatchObject({
      ok: false,
      code: "maximum_total_nodes_exceeded",
    });

    const keysPerShard = 10_000;
    const shard = `{${Array.from(
      { length: keysPerShard },
      (_, index) => `"k${index}":0`,
    ).join(",")}}`;
    const shardCount =
      Math.floor(policy.maximumTotalObjectKeys / keysPerShard) + 1;
    const tooManyTotalKeys = `[${Array(shardCount).fill(shard).join(",")}]`;
    expect(
      interpretNhm2ProlateBosonStarSeedRuntimeInstanceV3(
        "compositeReplayBundle",
        Buffer.from(tooManyTotalKeys, "utf8"),
      ),
    ).toMatchObject({
      ok: false,
      code: "maximum_total_object_keys_exceeded",
    });
  }, 30_000);

  it("rejects noncanonical bytes before schema, then schema before cross-field before asserted binding", () => {
    const value = fileObservationValue();
    const noncanonical = Buffer.from(JSON.stringify(value, null, 2), "utf8");
    expect(
      interpretNhm2ProlateBosonStarSeedRuntimeInstanceV3(
        "verifierChannelObservation",
        noncanonical,
      ),
    ).toMatchObject({
      ok: false,
      code: "raw_bytes_not_equal_recanonicalized_utf8",
      rejectionReceipt: { canonicalizationCompleted: true },
    });

    const schemaMismatch = fileObservationBytes({
      ...value,
      modeFileType: "directory",
    });
    expect(
      interpretNhm2ProlateBosonStarSeedRuntimeInstanceV3(
        "verifierChannelObservation",
        schemaMismatch,
      ),
    ).toMatchObject({
      ok: false,
      code: "exact_schema_or_union_profile_mismatch",
      rejectionReceipt: { canonicalizationCompleted: true },
    });

    const crossFieldMismatch = rootPrestateBytes({
      ...rootPrestateValue(),
      listingSha256: "0".repeat(64),
    });
    expect(
      interpretNhm2ProlateBosonStarSeedRuntimeInstanceV3(
        "rootPrestateReceipt",
        crossFieldMismatch,
      ),
    ).toMatchObject({
      ok: false,
      code: "cross_field_invariant_mismatch",
      rejectionReceipt: { canonicalizationCompleted: true },
    });

    const schemaValidButNotFullyReplayable =
      interpretNhm2ProlateBosonStarSeedRuntimeInstanceV3(
        "rootPrestateReceipt",
        rootPrestateBytes(),
      );
    expect(schemaValidButNotFullyReplayable).toMatchObject({
      ok: false,
      code: "cross_field_invariant_mismatch",
      rejectionReceipt: {
        canonicalizationCompleted: true,
        interpretationAccepted: false,
        registrationAllowed: false,
      },
    });
    if (schemaValidButNotFullyReplayable.ok === true) {
      throw new Error("root prestate must remain fail-closed");
    }
    expect(schemaValidButNotFullyReplayable.issues.join(" ")).toContain(
      "unsupported_semantics",
    );

    const validBytes = fileObservationBytes(value);
    const accepted = interpretNhm2ProlateBosonStarSeedRuntimeInstanceV3(
      "verifierChannelObservation",
      validBytes,
    );
    expect(accepted.ok).toBe(true);
    if (accepted.ok === false) throw new Error(accepted.code);
    expect(
      interpretNhm2ProlateBosonStarSeedRuntimeInstanceV3(
        "verifierChannelObservation",
        validBytes,
        { ...accepted.binding, sha256: "0".repeat(64) },
      ),
    ).toMatchObject({
      ok: false,
      code: "asserted_instance_binding_mismatch",
      rejectionReceipt: {
        canonicalizationCompleted: true,
        bindingCreated: false,
        interpretationAccepted: false,
        registrationAllowed: false,
      },
    });
  });

  it("snapshots asserted bindings without invoking accessors or hostile proxy traps", () => {
    const bytes = fileObservationBytes();
    let getterCalls = 0;
    const accessorBinding: Record<string, unknown> = {};
    Object.defineProperty(accessorBinding, "sha256", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return "0".repeat(64);
      },
    });
    const accessorResult = interpretNhm2ProlateBosonStarSeedRuntimeInstanceV3(
      "verifierChannelObservation",
      bytes,
      accessorBinding,
    );
    expect(accessorResult).toMatchObject({
      ok: false,
      code: "asserted_instance_binding_mismatch",
      rejectionReceipt: { attemptedInstanceBindingOrNull: null },
    });
    expect(getterCalls).toBe(0);

    const hostileProxy = new Proxy(Object.create(null), {
      ownKeys: () => {
        throw new Error("hostile ownKeys");
      },
    });
    expect(() =>
      interpretNhm2ProlateBosonStarSeedRuntimeInstanceV3(
        "verifierChannelObservation",
        bytes,
        hostileProxy,
      ),
    ).not.toThrow();
  });

  it("keeps the v3 authority source independent from the generic object JSON parser", async () => {
    const source = await readFile(
      join(
        process.cwd(),
        "server/services/theory/nhm2-prolate-boson-star-seed-runtime-instance-interpreter.v3.ts",
      ),
      "utf8",
    );
    expect(source).not.toContain("JSON.parse(");
    expect(source).not.toContain("registrationCallback");
    expect(source).not.toContain("launchCallback");
  });
});
