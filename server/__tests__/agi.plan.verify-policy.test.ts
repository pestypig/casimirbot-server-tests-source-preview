import { describe, it, expect } from "vitest";
import {
  buildHelixAskVerifyDegradedFirstFail,
  resolveHelixAskVerifyDegradeReason,
  resolveHelixAskVerifyPolicy,
} from "../services/helix-ask/verify-policy";

describe("helix ask verify policy", () => {
  it("uses strict fail-closed contract for repo-grounded verify", () => {
    const policy = resolveHelixAskVerifyPolicy({ repoGrounded: true });
    expect(policy.mode).toBe("strict");
    expect(policy.failClosed).toBe(true);
    expect(policy.allowSyntheticFallback).toBe(false);
  });

  it("keeps permissive mode labeled as degraded/non-verified", () => {
    const policy = resolveHelixAskVerifyPolicy({ requestedMode: "permissive" });
    expect(policy.mode).toBe("permissive");
    expect(policy.degradedLabel).toBe("non_verified_degraded");
  });

  it("emits deterministic degrade reasons and canonical certificate firstFail IDs", () => {
    expect(
      resolveHelixAskVerifyDegradeReason({
        adapterVerdict: "PASS",
        certificate: null,
      }),
    ).toBe("CERTIFICATE_MISSING");
    expect(buildHelixAskVerifyDegradedFirstFail("CERTIFICATE_MISSING").id).toBe(
      "ADAPTER_CERTIFICATE_MISSING",
    );
    expect(buildHelixAskVerifyDegradedFirstFail("CERTIFICATE_INTEGRITY").id).toBe(
      "ADAPTER_CERTIFICATE_INTEGRITY",
    );
    expect(buildHelixAskVerifyDegradedFirstFail("ADAPTER_ERROR").id).toBe(
      "ADAPTER_VERIFY_ADAPTER_ERROR",
    );
  });
});
