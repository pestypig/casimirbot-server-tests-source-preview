import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  NHM2_CONFORMALLY_FLAT_NEEDLE_SCALAR_CANDIDATE_PACK_BLOCKERS,
  NHM2_CONFORMALLY_FLAT_NEEDLE_SCALAR_CANDIDATE_PACK_MISSING_INPUT_IDS,
  NHM2_CONFORMALLY_FLAT_NEEDLE_SCALAR_CANDIDATE_PACK_PLAN,
  NHM2_CONFORMALLY_FLAT_NEEDLE_SCALAR_CANDIDATE_PACK_PLAN_CANONICAL_JSON,
  NHM2_CONFORMALLY_FLAT_NEEDLE_SCALAR_CANDIDATE_PACK_PLAN_SHA256,
  nhm2ConformallyFlatNeedleScalarCandidatePackPlanViolations,
  type Nhm2ConformallyFlatNeedleScalarCandidatePackPlanV1,
} from "../../../../shared/contracts/nhm2-conformally-flat-needle-scalar-candidate-pack-plan.v1";
import {
  NHM2_SEMICLASSICAL_V2_APPROVED_REPLAY_POLICY_RAW_BINDING,
  NHM2_SEMICLASSICAL_V2_RAW_REPLAY_FORBIDDEN_INPUT_IDS,
} from "../../../../shared/contracts/nhm2-semiclassical-v2-raw-replay-manifest.v1";
import { NHM2_SEMICLASSICAL_V2_SCIENTIFIC_CANDIDATE_NON_SELF_INPUT_IDS } from "../../../../shared/contracts/nhm2-semiclassical-v2-scientific-candidate-manifest.v1";
import {
  Nhm2ConformallyFlatNeedleScalarCandidatePackMaterializerError,
  materializeNhm2ConformallyFlatNeedleScalarCandidateManifestBytes,
  materializeNhm2ConformallyFlatNeedleScalarCandidatePackPlan,
  readNhm2ConformallyFlatNeedleScalarCandidatePackPlanBytes,
  readNhm2ConformallyFlatNeedleScalarReadyScienceInput,
} from "../nhm2-conformally-flat-needle-scalar-candidate-pack-materializer";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === "object" && !Array.isArray(value);

const canonicalJson = (value: unknown): string => {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (!isRecord(value)) throw new TypeError("fixture is not JSON");
  return `{${Object.keys(value)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
};

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const clonePlan = (): Nhm2ConformallyFlatNeedleScalarCandidatePackPlanV1 =>
  structuredClone(NHM2_CONFORMALLY_FLAT_NEEDLE_SCALAR_CANDIDATE_PACK_PLAN);

const replaceReadyJson = (
  plan: Nhm2ConformallyFlatNeedleScalarCandidatePackPlanV1,
  inputId: string,
  transform: (document: Record<string, unknown>) => void,
  encoding: "canonical" | "pretty" = "canonical",
): void => {
  const entry = plan.inputPlans.find(
    (candidate) => candidate.inputId === inputId,
  );
  if (entry?.canonicalBytesBase64 == null) {
    throw new Error(`Ready fixture ${inputId} is missing.`);
  }
  const document = JSON.parse(
    Buffer.from(entry.canonicalBytesBase64, "base64").toString("utf8"),
  ) as Record<string, unknown>;
  transform(document);
  const text =
    encoding === "canonical"
      ? canonicalJson(document)
      : JSON.stringify(document, null, 2);
  const bytes = Buffer.from(text, "utf8");
  entry.canonicalBytesBase64 = bytes.toString("base64");
  entry.sha256 = sha256(bytes);
  entry.sizeBytes = bytes.byteLength;
};

const expectMaterializerCode = (
  run: () => unknown,
  code: Nhm2ConformallyFlatNeedleScalarCandidatePackMaterializerError["code"],
): Nhm2ConformallyFlatNeedleScalarCandidatePackMaterializerError => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(
      Nhm2ConformallyFlatNeedleScalarCandidatePackMaterializerError,
    );
    expect(
      (error as Nhm2ConformallyFlatNeedleScalarCandidatePackMaterializerError)
        .code,
    ).toBe(code);
    return error as Nhm2ConformallyFlatNeedleScalarCandidatePackMaterializerError;
  }
  throw new Error(`Expected materializer error ${code}.`);
};

describe.sequential(
  "NHM2 conformally-flat needle scalar candidate-pack materializer",
  () => {
    it("returns one deterministic exact 22-slot output-free pure plan", () => {
      const first =
        materializeNhm2ConformallyFlatNeedleScalarCandidatePackPlan();
      const second =
        materializeNhm2ConformallyFlatNeedleScalarCandidatePackPlan();

      expect(first).toBe(second);
      expect(first.inputPlans).toHaveLength(22);
      expect(first.expectedInputIds).toEqual(
        NHM2_SEMICLASSICAL_V2_SCIENTIFIC_CANDIDATE_NON_SELF_INPUT_IDS,
      );
      expect(first.inputPlans.map((entry) => entry.inputId)).toEqual(
        NHM2_SEMICLASSICAL_V2_SCIENTIFIC_CANDIDATE_NON_SELF_INPUT_IDS,
      );
      expect(first.inputPlans.map((entry) => entry.ordinal)).toEqual(
        Array.from({ length: 22 }, (_, index) => index),
      );
      expect(first.closure).toMatchObject({
        expectedInputCount: 22,
        readyInputCount: 14,
        missingInputCount: 8,
        complete: false,
        missingInputIds:
          NHM2_CONFORMALLY_FLAT_NEEDLE_SCALAR_CANDIDATE_PACK_MISSING_INPUT_IDS,
        candidateManifestCanonicalBytesBase64: null,
        candidateManifestSha256: null,
        candidateManifestSizeBytes: null,
        scientificPresealBytesBase64: null,
        refreezeRequiredAfterScientificClosure: true,
      });
      expect(first.authorityState).toEqual({
        status: "blocked",
        firstBlocker: "metric_demand_tensor_bytes_missing",
        blockers: [
          ...NHM2_CONFORMALLY_FLAT_NEEDLE_SCALAR_CANDIDATE_PACK_BLOCKERS,
        ],
      });
      expect(first.candidateTarget).toMatchObject({
        selectedProfileId: "conformally_flat_needle_reference",
        metricDemandInputId: "metric_demand_tensor",
        metricDemandErrorBoundInputId:
          "metric_demand_absolute_error_bound",
        metricDemandDerivationReceiptInputId:
          "metric_demand_derivation_receipt",
        candidateFrozenAt: null,
        nondegeneracyEstablished: false,
        metricDemandDerivationReceiptVerified: false,
        metricDemandIntervalTraceServerReplayed: false,
        sourceMode: "state_derived_not_declared_lever",
        declaredLeverTensorUsed: false,
      });
      expect(
        Object.values(first.claimLocks).every((value) => value === false),
      ).toBe(true);
      expect(Object.isFrozen(first)).toBe(true);
      expect(Object.isFrozen(first.inputPlans)).toBe(true);
      expect(Object.isFrozen(first.inputPlans[0])).toBe(true);
      expect(
        nhm2ConformallyFlatNeedleScalarCandidatePackPlanViolations(first),
      ).toEqual([]);
      const firstBytes =
        readNhm2ConformallyFlatNeedleScalarCandidatePackPlanBytes();
      firstBytes[0] ^= 0xff;
      const secondBytes =
        readNhm2ConformallyFlatNeedleScalarCandidatePackPlanBytes();
      expect(secondBytes.toString("utf8")).toBe(
        NHM2_CONFORMALLY_FLAT_NEEDLE_SCALAR_CANDIDATE_PACK_PLAN_CANONICAL_JSON,
      );
      expect(sha256(secondBytes)).toBe(
        NHM2_CONFORMALLY_FLAT_NEEDLE_SCALAR_CANDIDATE_PACK_PLAN_SHA256,
      );
    });

    it("binds every ready byte sequence to exact canonical content, hash, size, media and descriptor", () => {
      const plan =
        materializeNhm2ConformallyFlatNeedleScalarCandidatePackPlan();
      const ready = plan.inputPlans.filter(
        (entry) =>
          entry.materializationStatus === "canonical_science_bytes_ready",
      );
      expect(ready).toHaveLength(14);
      for (const entry of ready) {
        expect(entry.mediaType).toBe("application/json");
        expect(entry.byteEncoding).toBe("canonical_json_utf8");
        expect(entry.blocker).toBeNull();
        const bytes = Buffer.from(entry.canonicalBytesBase64!, "base64");
        expect(bytes.byteLength).toBe(entry.sizeBytes);
        expect(sha256(bytes)).toBe(entry.sha256);
        const text = bytes.toString("utf8");
        expect(canonicalJson(JSON.parse(text))).toBe(text);
        expect(entry.descriptor.scientificInputId).toBe(entry.inputId);
      }
      const policy = plan.inputPlans.find(
        (entry) => entry.inputId === "tolerance_policy",
      );
      expect(policy).toMatchObject({
        sha256: NHM2_SEMICLASSICAL_V2_APPROVED_REPLAY_POLICY_RAW_BINDING.sha256,
        sizeBytes:
          NHM2_SEMICLASSICAL_V2_APPROVED_REPLAY_POLICY_RAW_BINDING.sizeBytes,
        mediaType:
          NHM2_SEMICLASSICAL_V2_APPROVED_REPLAY_POLICY_RAW_BINDING.mediaType,
        descriptor: {
          descriptorKind: "approved_replay_policy",
          policyId:
            NHM2_SEMICLASSICAL_V2_APPROVED_REPLAY_POLICY_RAW_BINDING.policyId,
        },
      });
      const metric = plan.inputPlans.find(
        (entry) => entry.inputId === "metric_demand_tensor",
      );
      expect(metric).toMatchObject({
        materializationStatus: "missing_required_science",
        canonicalBytesBase64: null,
        sha256: null,
        sizeBytes: null,
        mediaType: "application/octet-stream",
        byteEncoding: "raw_ieee754_float64_little_endian",
        descriptor: {
          descriptorKind: "metric_demand_tensor_float64",
          shape: [64, 10],
          storageOrder: "row-major",
          unit: "J/m^3",
        },
      });
      const metricErrorBound = plan.inputPlans.find(
        (entry) =>
          entry.inputId === "metric_demand_absolute_error_bound",
      );
      expect(metricErrorBound).toMatchObject({
        materializationStatus: "missing_required_science",
        canonicalBytesBase64: null,
        sha256: null,
        sizeBytes: null,
        mediaType: "application/octet-stream",
        byteEncoding: "raw_ieee754_float64_little_endian",
        descriptor: {
          descriptorKind: "metric_demand_absolute_error_bound_float64",
          shape: [64, 10],
          storageOrder: "row-major",
          unit: "J/m^3",
        },
      });
      const metricDerivationReceipt = plan.inputPlans.find(
        (entry) => entry.inputId === "metric_demand_derivation_receipt",
      );
      expect(metricDerivationReceipt).toMatchObject({
        materializationStatus: "missing_required_science",
        canonicalBytesBase64: null,
        sha256: null,
        sizeBytes: null,
        mediaType: "application/json",
        byteEncoding: "canonical_json_utf8",
        descriptor: {
          descriptorKind: "metric_demand_derivation_receipt",
          scientificInputId: "metric_demand_derivation_receipt",
          scientificObjectId:
            "nhm2.conformally_flat_needle_scalar_reference.candidate/v1",
        },
      });
    });

    it("returns fresh read-only-by-contract copies for ready inputs and rejects unresolved inputs", () => {
      const first =
        readNhm2ConformallyFlatNeedleScalarReadyScienceInput("geometry");
      const original = Buffer.from(first.bytes);
      first.bytes[0] ^= 0xff;
      const second =
        readNhm2ConformallyFlatNeedleScalarReadyScienceInput("geometry");
      expect(second.bytes).toEqual(original);
      expect(second.bytes).not.toBe(first.bytes);
      expect(second.plan.sha256).toBe(sha256(second.bytes));

      for (const inputId of NHM2_CONFORMALLY_FLAT_NEEDLE_SCALAR_CANDIDATE_PACK_MISSING_INPUT_IDS) {
        const error = expectMaterializerCode(
          () => readNhm2ConformallyFlatNeedleScalarReadyScienceInput(inputId),
          "scientific_input_incomplete",
        );
        expect(error.inputId).toBe(inputId);
        expect(error.blockers).toHaveLength(1);
      }
      expectMaterializerCode(
        () =>
          readNhm2ConformallyFlatNeedleScalarReadyScienceInput(
            "not-an-input" as "geometry",
          ),
        "scientific_input_id_invalid",
      );
    });

    it("never emits candidate-manifest bytes while any science blocker remains", () => {
      const error = expectMaterializerCode(
        materializeNhm2ConformallyFlatNeedleScalarCandidateManifestBytes,
        "candidate_pack_incomplete",
      );
      expect(error.blockers).toEqual(
        NHM2_CONFORMALLY_FLAT_NEEDLE_SCALAR_CANDIDATE_PACK_BLOCKERS,
      );
    });

    it("rejects canonical semantic drift even when the attacker recomputes hash and size", () => {
      const changed = clonePlan();
      replaceReadyJson(changed, "geometry", (document) => {
        const semantics = document.semantics as Record<string, unknown>;
        const conformalFactor = semantics.conformalFactor as Record<
          string,
          unknown
        >;
        conformalFactor.amplitude = 0.5;
      });
      const violations =
        nhm2ConformallyFlatNeedleScalarCandidatePackPlanViolations(changed);
      expect(violations).toContain("candidate_pack_plan_semantic_drift");
      expect(violations).toContain("input_plan_semantic_drift:geometry");
    });

    it("rejects a missing or reordered scientific input", () => {
      const missing = clonePlan();
      missing.inputPlans.splice(3, 1);
      expect(
        nhm2ConformallyFlatNeedleScalarCandidatePackPlanViolations(missing),
      ).toContain("scientific_input_inventory_invalid");

      const reordered = clonePlan();
      const first = reordered.expectedInputIds[0];
      reordered.expectedInputIds[0] = reordered.expectedInputIds[1];
      reordered.expectedInputIds[1] = first;
      expect(
        nhm2ConformallyFlatNeedleScalarCandidatePackPlanViolations(reordered),
      ).toContain("scientific_input_inventory_invalid");
    });

    it("rejects operational output-path leakage inside otherwise canonical science bytes", () => {
      const changed = clonePlan();
      replaceReadyJson(changed, "geometry", (document) => {
        document.outputDirectory = "C:\\attacker\\run-output";
      });
      expect(
        nhm2ConformallyFlatNeedleScalarCandidatePackPlanViolations(changed),
      ).toContain(
        "science_bytes_contain_operational_path_or_runtime_fields:geometry",
      );
    });

    it("rejects every declared-lever identity inside otherwise canonical science bytes", () => {
      for (const identity of NHM2_SEMICLASSICAL_V2_RAW_REPLAY_FORBIDDEN_INPUT_IDS) {
        const changed = clonePlan();
        replaceReadyJson(changed, "geometry", (document) => {
          document.scientificObjectId = identity;
        });
        const violations =
          nhm2ConformallyFlatNeedleScalarCandidatePackPlanViolations(changed);
        expect(violations).toContain(
          "declared_lever_identity_forbidden:geometry",
        );
      }
    });

    it("rejects noncanonical JSON even when its hash and size are internally consistent", () => {
      const changed = clonePlan();
      replaceReadyJson(changed, "geometry", () => undefined, "pretty");
      expect(
        nhm2ConformallyFlatNeedleScalarCandidatePackPlanViolations(changed),
      ).toContain("science_bytes_noncanonical:geometry");
    });

    it("rejects false claim promotion and injected candidate or preseal bytes", () => {
      const promoted = clonePlan();
      (
        promoted.claimLocks as unknown as Record<string, boolean>
      ).physicalViability = true;
      expect(
        nhm2ConformallyFlatNeedleScalarCandidatePackPlanViolations(promoted),
      ).toContain("claim_locks_not_all_false");

      const injected = clonePlan();
      (
        injected.closure as unknown as Record<string, unknown>
      ).candidateManifestCanonicalBytesBase64 = Buffer.from(
        '{\n  "fake": true\n}',
        "utf8",
      ).toString("base64");
      (
        injected.closure as unknown as Record<string, unknown>
      ).scientificPresealBytesBase64 = Buffer.from("{}", "utf8").toString(
        "base64",
      );
      expect(
        nhm2ConformallyFlatNeedleScalarCandidatePackPlanViolations(injected),
      ).toContain("candidate_manifest_and_preseal_must_remain_unmaterialized");
    });

    it("rejects hidden, symbolic, and accessor-backed surfaces without invoking accessors", () => {
      const hidden = clonePlan();
      Object.defineProperty(hidden, "outputDirectory", {
        value: "relative/private-output",
        enumerable: false,
      });
      expect(
        nhm2ConformallyFlatNeedleScalarCandidatePackPlanViolations(hidden),
      ).toEqual(["candidate_pack_plan_noncanonical_object_surface"]);

      const symbolic = clonePlan();
      Object.defineProperty(symbolic, Symbol("authority"), {
        value: true,
        enumerable: true,
      });
      expect(
        nhm2ConformallyFlatNeedleScalarCandidatePackPlanViolations(symbolic),
      ).toEqual(["candidate_pack_plan_noncanonical_object_surface"]);

      const accessor = clonePlan();
      let getterCalls = 0;
      Object.defineProperty(accessor, "status", {
        get: () => {
          getterCalls += 1;
          return "blocked_incomplete_scientific_input_closure";
        },
        enumerable: true,
      });
      expect(
        nhm2ConformallyFlatNeedleScalarCandidatePackPlanViolations(accessor),
      ).toEqual(["candidate_pack_plan_noncanonical_object_surface"]);
      expect(getterCalls).toBe(0);
    });
  },
);
