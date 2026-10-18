import { describe, expect, it } from "vitest";
import { readBuiltinEnvironmentConnectorPackage } from "../../catalog";
import {
  decidePrivatePackageOperation, PRIVATE_CLOCK_CONTENT_HASH, PRIVATE_CLOCK_PACKAGE_ID,
  PRIVATE_DIRECTORY_EXPIRES_AT, PRIVATE_DIRECTORY_VALID_FROM,
  type PackagePolicyRecord, type PrivateDirectoryAccess, type PackagePolicyOperation,
} from "../release-policy";

const access: PrivateDirectoryAccess = {
  trustedAccountSession: true, accountType: "developer", profileId: "profile:owner",
  loopback: true, featureEnabled: true,
};
const fixture = (): Parameters<typeof decidePrivatePackageOperation>[0] => {
  const pkg = readBuiltinEnvironmentConnectorPackage(PRIVATE_CLOCK_PACKAGE_ID)!;
  return {
    access: { ...access }, now: new Date("2026-09-26T12:00:00Z"),
    host: { platform: "win32", nodeMajor: 22 }, operation: "list" as PackagePolicyOperation,
    record: {
      package_version_id: pkg.packageVersionId, publisher_id: pkg.publisherId,
      package_id: pkg.packageId, package_version: pkg.packageVersion,
      content_hash: PRIVATE_CLOCK_CONTENT_HASH, host_compatibility: pkg.hostCompatibility,
      capability_descriptors: pkg.capabilityDescriptors, lifecycle_status: "active", withdrawn_at: null,
    } satisfies PackagePolicyRecord,
  };
};

describe("private G1.6A package release policy", () => {
  it.each(["valid", "device", "artifact", "host", "platform", "node"])("requires reviewed native installation facts: %s", kind => {
    const input = fixture(); input.operation = "install"; input.host.nodeMajor = 24;
    input.nativeInstall = { desktopHost: true, deviceId: `desktop_device_${"a".repeat(22)}`,
      artifactSha256: "55b95cb3aa05f686e0d6b3cac1e33bf360b18f70ccde109fa55c7d3bd083dc7b" };
    if (kind === "device") input.nativeInstall.deviceId = "spoof";
    if (kind === "artifact") input.nativeInstall.artifactSha256 = "a".repeat(64);
    if (kind === "host") input.nativeInstall.desktopHost = false;
    if (kind === "platform") input.host.platform = "linux";
    if (kind === "node") input.host.nodeMajor = 22;
    expect(decidePrivatePackageOperation(input).allowed).toBe(kind === "valid");
  });
  it("admits exact reviewed clock metadata, including serialized database JSON", () => {
    const input = fixture();
    expect(decidePrivatePackageOperation(input).allowed).toBe(true);
    input.record.host_compatibility = JSON.stringify(input.record.host_compatibility);
    input.record.capability_descriptors = JSON.stringify(input.record.capability_descriptors);
    expect(decidePrivatePackageOperation(input).allowed).toBe(true);
  });

  it.each([
    { trustedAccountSession: false }, { accountType: "user" }, { profileId: null },
    { profileId: " " }, { loopback: false }, { featureEnabled: false },
  ])("requires every private access condition: %j", (change) => {
    const input = fixture();
    Object.assign(input.access, change);
    expect(decidePrivatePackageOperation(input)).toMatchObject({ allowed: false, reason: "private_directory_access_denied" });
  });

  it.each(["invalid", "2026-09-25T23:59:59.999Z", PRIVATE_DIRECTORY_EXPIRES_AT, "2026-10-02T00:00:00Z"])(
    "fails closed for invalid, premature or expired policy time %s", (date) => {
      expect(decidePrivatePackageOperation({ ...fixture(), now: new Date(date) })).toMatchObject({
        allowed: false, reason: "package_policy_unavailable",
      });
    },
  );
  it("uses an inclusive start and exclusive expiry", () => {
    expect(decidePrivatePackageOperation({ ...fixture(), now: new Date(PRIVATE_DIRECTORY_VALID_FROM) }).allowed).toBe(true);
    expect(decidePrivatePackageOperation({ ...fixture(), now: new Date(Date.parse(PRIVATE_DIRECTORY_EXPIRES_AT) - 1) }).allowed).toBe(true);
  });

  it.each(["com.casimirbot.minecraft.paper:1.1.0", "com.casimirbot.synthetic.fixture:1.0.0", "com.casimirbot.system.clock:2.0.0"])(
    "rejects excluded or unreviewed exact identity %s", (id) => {
      const input = fixture();
      input.record.package_version_id = `connector_package_version:${id}`;
      expect(decidePrivatePackageOperation(input)).toMatchObject({ allowed: false, reason: "package_policy_excluded" });
    },
  );

  it.each([
    { publisher_id: "publisher:other" }, { package_id: "changed" }, { package_version: "2.0.0" },
    { content_hash: "sha256:changed" }, { host_compatibility: ["node:18+"] },
    { capability_descriptors: [] }, { capability_descriptors: "malformed" },
  ])("rejects persisted drift despite retained approved hash: %j", (change) => {
    const input = fixture();
    Object.assign(input.record, change);
    expect(decidePrivatePackageOperation(input)).toMatchObject({ allowed: false, reason: "package_policy_metadata_drift" });
  });

  it.each(["withdrawn", "revoked", "deprecated"])("rejects lifecycle %s", (status) => {
    const input = fixture(); input.record.lifecycle_status = status;
    expect(decidePrivatePackageOperation(input)).toMatchObject({ allowed: false, reason: "package_policy_withdrawn" });
  });
  it("does not trust active status when withdrawal is recorded", () => {
    const input = fixture(); Object.assign(input.record, { withdrawn_at: "2026-09-26T10:00:00Z" });
    expect(decidePrivatePackageOperation(input)).toMatchObject({ allowed: false, reason: "package_policy_withdrawn" });
  });
  it.each([{ platform: "freebsd", nodeMajor: 22 }, { platform: "win32", nodeMajor: 18 }, { platform: "win32", nodeMajor: NaN }])(
    "rejects incompatible host %j", (host) => {
      expect(decidePrivatePackageOperation({ ...fixture(), host })).toMatchObject({ allowed: false, reason: "package_policy_host_incompatible" });
    },
  );
  it.each<PackagePolicyOperation>(["install"])(
    "does not infer %s authority from device registration", (operation) => {
      expect(decidePrivatePackageOperation({ ...fixture(), operation })).toMatchObject({ allowed: false, reason: "package_policy_operation_not_admitted" });
    },
  );
  it.each<PackagePolicyOperation>(["pair_start", "pair_approve", "pair_claim", "probe_poll", "probe_result", "heartbeat"])(
    "admits the reviewed clock operation %s under the same policy", (operation) => {
      expect(decidePrivatePackageOperation({ ...fixture(), operation }).allowed).toBe(true);
    },
  );
});
